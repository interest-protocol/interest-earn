import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  DineroVault,
  MintableERC20,
  MintableERC20Decimal,
  MockDinero,
} from '../typechain-types';
import { deploy } from './utils';

const { parseEther } = ethers.utils;

const MAX_MINT_AMOUNT = parseEther('1000');

const USDT_DECIMALS = 6;

const parseUSDT = (x: number) =>
  ethers.BigNumber.from(x).mul(ethers.BigNumber.from(10).pow(USDT_DECIMALS));

async function deployFixture() {
  // Contracts are deployed using the first signer/account by default
  const [owner, alice] = await ethers.getSigners();

  const [busd, dinero] = await Promise.all([
    deploy('MintableERC20', ['Binance USD', 'BUSD']) as Promise<MintableERC20>,
    deploy('MockDinero', []) as Promise<MockDinero>,
  ]);

  const dineroVault: DineroVault = await deploy('DineroVault', [
    dinero.address,
    busd.address,
    MAX_MINT_AMOUNT,
  ]);

  await Promise.all([
    busd.mint(alice.address, parseEther('20000')),
    busd
      .connect(alice)
      .approve(dineroVault.address, ethers.constants.MaxUint256),
  ]);

  return {
    dineroVault,
    owner,
    alice,
    busd,
    dinero,
  };
}

async function deployFixtureSecond() {
  // Contracts are deployed using the first signer/account by default
  const [owner, alice] = await ethers.getSigners();

  const [usdt, dinero] = await Promise.all([
    deploy('MintableERC20Decimal', [
      'USD Tether',
      'USDT',
      USDT_DECIMALS,
    ]) as Promise<MintableERC20Decimal>,
    deploy('MockDinero', []) as Promise<MockDinero>,
  ]);

  const dineroVault: DineroVault = await deploy('DineroVault', [
    dinero.address,
    usdt.address,
    MAX_MINT_AMOUNT,
  ]);

  await Promise.all([
    usdt.mint(alice.address, parseUSDT(20000)),
    usdt
      .connect(alice)
      .approve(dineroVault.address, ethers.constants.MaxUint256),
  ]);

  return {
    dineroVault,
    owner,
    alice,
    usdt,
    dinero,
  };
}

describe('DineroVault', function () {
  describe('deposit(uint256)', function () {
    it('reverts if you deposit more than the maximum mint amount', async () => {
      const { dineroVault, alice } = await loadFixture(deployFixture);

      await dineroVault.connect(alice).deposit(parseEther('900'));

      await expect(
        dineroVault.connect(alice).deposit(parseEther('101'))
      ).to.revertedWithCustomError(
        dineroVault,
        'DineroVault__MaxDineroAmountReached'
      );
    });

    it('mints correct amount of dinero', async () => {
      const { dineroVault, busd, dinero, alice } = await loadFixture(
        deployFixture
      );

      expect(await dineroVault.balanceOf(alice.address)).to.be.equal(0);
      expect(await dineroVault.mintedDineroAmount()).to.be.equal(0);

      await expect(dineroVault.connect(alice).deposit(parseEther('900')))
        .to.emit(dineroVault, 'Deposit')
        .withArgs(alice.address, parseEther('900'), parseEther('900'))
        .to.emit(busd, 'Transfer')
        .withArgs(alice.address, dineroVault.address, parseEther('900'))
        .to.emit(dinero, 'Transfer')
        .withArgs(
          ethers.constants.AddressZero,
          alice.address,
          parseEther('900')
        );

      expect(await dineroVault.mintedDineroAmount()).to.be.equal(
        parseEther('900')
      );

      expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
        parseEther('900')
      );
    });
  });

  describe('withdraw(uint256)', function () {
    it('reverts if the user does not have enough dinero', async () => {
      const { dineroVault, dinero, alice, owner } = await loadFixture(
        deployFixture
      );

      await dineroVault.connect(alice).deposit(parseEther('100'));

      await dinero.connect(alice).transfer(owner.address, parseEther('1'));

      await expect(dineroVault.connect(alice).withdraw(parseEther('100'))).to
        .reverted;
    });

    it('reverts if the user withdraws more than what he deposited', async () => {
      const { dineroVault, alice } = await loadFixture(deployFixture);

      await dineroVault.connect(alice).deposit(parseEther('100'));

      await expect(dineroVault.connect(alice).withdraw(parseEther('101'))).to
        .reverted;
    });

    it('allows a user to withdraw', async () => {
      const { dineroVault, alice, dinero, busd } = await loadFixture(
        deployFixture
      );

      await dineroVault.connect(alice).deposit(parseEther('100'));

      expect(await dineroVault.mintedDineroAmount()).to.be.equal(
        parseEther('100')
      );

      expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
        parseEther('100')
      );

      await expect(dineroVault.connect(alice).withdraw(parseEther('50')))
        .to.emit(dineroVault, 'Withdraw')
        .withArgs(alice.address, parseEther('50'), parseEther('50'))
        .to.emit(dinero, 'Transfer')
        .withArgs(alice.address, ethers.constants.AddressZero, parseEther('50'))
        .to.emit(busd, 'Transfer')
        .withArgs(dineroVault.address, alice.address, parseEther('50'));

      expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
        parseEther('50')
      );

      expect(await dineroVault.mintedDineroAmount()).to.be.equal(
        parseEther('50')
      );
    });
  });

  describe('setMaxDineroAmount(uint256)', function () {
    it('reverts if it is not called by the owner', async () => {
      const { dineroVault, alice } = await loadFixture(deployFixture);

      await expect(
        dineroVault.connect(alice).setMaxDineroAmount(parseEther('10'))
      ).to.rejectedWith('Ownable: caller is not the owner');
    });

    it('updates the maxDineroAmount', async () => {
      const { dineroVault, owner, alice } = await loadFixture(deployFixture);

      await expect(dineroVault.connect(alice).deposit(MAX_MINT_AMOUNT.add(1)))
        .to.reverted;

      await expect(
        dineroVault.connect(owner).setMaxDineroAmount(MAX_MINT_AMOUNT.add(1))
      )
        .to.emit(dineroVault, 'MaxDineroAmount')
        .withArgs(MAX_MINT_AMOUNT, MAX_MINT_AMOUNT.add(1));

      await expect(dineroVault.connect(alice).deposit(MAX_MINT_AMOUNT.add(1)))
        .to.emit(dineroVault, 'Deposit')
        .withArgs(
          alice.address,
          MAX_MINT_AMOUNT.add(1),
          MAX_MINT_AMOUNT.add(1)
        );
    });
  });

  describe('Underlying with non-standard decimal', function () {
    describe('deposit(uint256)', function () {
      it('reverts if you deposit more than the maximum mint amount', async () => {
        const { dineroVault, alice } = await loadFixture(deployFixtureSecond);

        await dineroVault.connect(alice).deposit(parseUSDT(900));

        await expect(
          dineroVault.connect(alice).deposit(parseUSDT(101))
        ).to.revertedWithCustomError(
          dineroVault,
          'DineroVault__MaxDineroAmountReached'
        );
      });

      it('mints correct amount of dinero', async () => {
        const { dineroVault, usdt, dinero, alice } = await loadFixture(
          deployFixtureSecond
        );

        expect(await dineroVault.balanceOf(alice.address)).to.be.equal(0);
        expect(await dineroVault.mintedDineroAmount()).to.be.equal(0);

        await expect(dineroVault.connect(alice).deposit(parseUSDT(800)))
          .to.emit(dineroVault, 'Deposit')
          .withArgs(alice.address, parseUSDT(800), parseEther('800'))
          .to.emit(usdt, 'Transfer')
          .withArgs(alice.address, dineroVault.address, parseUSDT(800))
          .to.emit(dinero, 'Transfer')
          .withArgs(
            ethers.constants.AddressZero,
            alice.address,
            parseEther('800')
          );

        expect(await dineroVault.mintedDineroAmount()).to.be.equal(
          parseEther('800')
        );

        expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
          parseUSDT(800)
        );
      });
    });

    describe('withdraw(uint256)', function () {
      it('reverts if the user does not have enough dinero', async () => {
        const { dineroVault, dinero, alice, owner } = await loadFixture(
          deployFixtureSecond
        );

        await dineroVault.connect(alice).deposit(parseUSDT(100));

        await dinero.connect(alice).transfer(owner.address, parseEther('1'));

        await expect(dineroVault.connect(alice).withdraw(parseUSDT(100))).to
          .reverted;
      });

      it('reverts if the user withdraws more than what he deposited', async () => {
        const { dineroVault, alice } = await loadFixture(deployFixtureSecond);

        await dineroVault.connect(alice).deposit(parseUSDT(100));

        await expect(dineroVault.connect(alice).withdraw(parseUSDT(101))).to
          .reverted;
      });

      it('allows a user to withdraw', async () => {
        const { dineroVault, alice, dinero, usdt } = await loadFixture(
          deployFixtureSecond
        );

        await dineroVault.connect(alice).deposit(parseUSDT(100));

        expect(await dineroVault.mintedDineroAmount()).to.be.equal(
          parseEther('100')
        );

        expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
          parseUSDT(100)
        );

        await expect(dineroVault.connect(alice).withdraw(parseUSDT(40)))
          .to.emit(dineroVault, 'Withdraw')
          .withArgs(alice.address, parseUSDT(40), parseEther('40'))
          .to.emit(dinero, 'Transfer')
          .withArgs(
            alice.address,
            ethers.constants.AddressZero,
            parseEther('40')
          )
          .to.emit(usdt, 'Transfer')
          .withArgs(dineroVault.address, alice.address, parseUSDT(40));

        expect(await dineroVault.balanceOf(alice.address)).to.be.equal(
          parseUSDT(60)
        );

        expect(await dineroVault.mintedDineroAmount()).to.be.equal(
          parseEther('60')
        );
      });
    });
  });
});
