const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  impersonateAccount,
  mineBlocks,
  getCtokenEquiv,
  _getUnderlyingEquiv,
  _getCtokenEquiv,
} = require("./helpers/utils");

// ABIs...
const { cDAI_ABI } = require("./abi/cdai");
const { DAI_ABI } = require("./abi/dai");
const { cAAVE_ABI } = require("./abi/caave");
const { AAVE_ABI } = require("./abi/aave");

// Payment options...
const DAI = process.env.DAI;
const USDT = process.env.USDT;
const AAVE = process.env.AAVE;
//
const cDAI = process.env.CDAI;
const cAAVE = process.env.CAAVE;
const cUSDT = process.env.CUSDT;

const USDT_WHALE = process.env.USDT_WHALE;
const DAI_WHALE = process.env.DAI_WHALE;

describe("CompoundController", function () {
  before(async () => {
    [deployer, user1, user2] = await ethers.getSigners();

    // Deployment configs
    Vault = await ethers.getContractFactory("Vault");
    vault = await Vault.deploy();

    CompoundController = await ethers.getContractFactory("CompoundController");
    compoundController = await CompoundController.deploy();

    UserWallet = await ethers.getContractFactory("UserWallet");
    userWallet = await UserWallet.deploy(
      vault.address,
      compoundController.address
    );

    vault.transferOwnership(userWallet.address);
    // Deployment config ends...

    Usdt = await ethers.getContractAt("IERC20", USDT);
    //
    Dai = await ethers.getContractAt("IERC20", DAI);
    Cdai = new ethers.Contract(cDAI, cDAI_ABI, ethers.provider);
    //
    Aave = await ethers.getContractAt("IERC20", AAVE);
    Caave = new ethers.Contract(cAAVE, cAAVE_ABI, ethers.provider);

    // Impersonate an account with enough DAI
    signer = await impersonateAccount(DAI_WHALE);
  });
  describe("investInCompound", function () {
    it("should fail if user vault balance for token is zero", async () => {
      let investingAmount = BigNumber.from("100000000000000000000"); //  100
      await expect(
        userWallet.connect(signer).investInCompound(DAI, cDAI, investingAmount)
      ).to.be.revertedWith("Wallet: fund your wallet to continue!");
    });
    // Deposit 100 DAI to wallet
    it("should fail if amount being invested is less than one", async () => {
      let depositAmount = BigNumber.from("100000000000000000000"); //  100
      await Dai.connect(signer).approve(userWallet.address, depositAmount);
      await userWallet.connect(signer).deposit(Dai.address, depositAmount);
      await expect(
        userWallet.connect(signer).investInCompound(DAI, cDAI, "0")
      ).to.be.revertedWith("Wallet: Invest amount must be greater than zero!");
    });
    it("should fail if amount being invested is greater than user token balance in vault", async () => {
      await expect(
        userWallet
          .connect(signer)
          .investInCompound(DAI, cDAI, BigNumber.from("200000000000000000000"))
      ).to.be.revertedWith("Wallet: Insufficient token funds for user!"); //  200
    });
    it("should return true if investment in compound is successfully", async () => {
      let investingAmount = BigNumber.from("100000000000000000000"); //  100
      let result = await userWallet
        .connect(signer)
        .callStatic.investInCompound(DAI, cDAI, investingAmount);
      expect(result).to.equal(true);
    });
    // Invested 50 DAI to compound from wallet
    it("should assert user invested balance is correct if successfull", async () => {
      let depositAmount = BigNumber.from("50000000000000000000"); //  50
      await userWallet
        .connect(signer)
        .investInCompound(DAI, cDAI, depositAmount);
      let result = await compoundController
        .connect(signer)
        .UserInvestments(signer.address, 1);
      expect(result.tokenAmount).to.equal(depositAmount);
    });
    it("should assert user remaining token balance in vault(wallet) is correct", async () => {
      let investedAmount = BigNumber.from("50000000000000000000"); //  50
      let userBalance = await vault.getUserTokenBalance(signer.address, DAI);
      expect(userBalance).to.equal(investedAmount);
    });
    it("should assert no of cDAI tokens owned by compoundController if successfull", async () => {
      // 8 Decimals...
      let totalCdaiBalance = await Cdai.balanceOf(compoundController.address);
      expect(totalCdaiBalance).to.be.above(0); // Not recommended
    });
    // Deposit 5000 DAI in vault, then invest it in compound
    it("should calculate user investment balance + interest", async () => {
      let amount = BigNumber.from("5000000000000000000000"); //  5000
      await Dai.connect(signer).approve(userWallet.address, amount);
      await userWallet.connect(signer).deposit(Dai.address, amount);

      let cTokenEquiv = getCtokenEquiv(DAI_ABI, DAI, cDAI_ABI, cDAI, amount);
      await userWallet
        .connect(signer)
        .investInCompound(DAI, cDAI, amount, cTokenEquiv);

      //
      let userInvestment = await compoundController._getUserInvestment(
        signer.address,
        2
      );

      let exchangeRateCurrent = await Cdai.callStatic.exchangeRateCurrent();
      let cTokenInvested = await _getCtokenEquiv(
        DAI_ABI,
        DAI,
        userInvestment.tokenAmount,
        exchangeRateCurrent
      );
      console.log("--- before mining starts ---");
      console.log(amount / 10 ** 18);
      await mineBlocks(40);
      console.log("--- after mining some blocks ---");
      let _exchangeRateCurrent = await Cdai.callStatic.exchangeRateCurrent();
      let currentUserBalance = await _getUnderlyingEquiv(
        DAI_ABI,
        DAI,
        cTokenInvested,
        _exchangeRateCurrent
      );
      console.log(currentUserBalance / 10 ** 18);
    });
  });
  describe("withdrawFromCompound", function () {
    it("should fail if user has not invested", async () => {
      let withdrawAmount = BigNumber.from("100000000000000000000"); //  100
      await expect(
        userWallet
          .connect(user1)
          .withdrawFromCompound(DAI, cDAI, withdrawAmount, 1)
      ).to.be.revertedWith("Withdraw: invest in compound to continue!");
    });
    it("should fail if withdraw amount is less than 1", async () => {
      let withdrawAmount = 0;
      await expect(
        userWallet
          .connect(signer)
          .withdrawFromCompound(DAI, cDAI, withdrawAmount, 1)
      ).to.be.revertedWith(
        "Withdraw: Withdrawal amount must be greater than zero!"
      );
    });
    /* it("should fail if withdraw amount is greater than investment balance + interest", async () => {
      let withdrawAmount = BigNumber.from("110000000000000000000"); //  110
      await expect(
        userWallet.connect(signer).withdrawFromCompound(DAI, cDAI, withdrawAmount, 1)
      ).to.be.revertedWith("Withdraw: Withdrawal amount must be greater than zero!");

    }) */
    // Withdraw 100 DAI from compound
    it("should increment total vault token balance if successfull", async () => {
      let expectedVaultBalance = BigNumber.from("150000000000000000000"); //  150
      let withdrawAmount = BigNumber.from("100000000000000000000"); //  100

      await userWallet
        .connect(signer)
        .withdrawFromCompound(DAI, cDAI, withdrawAmount, 2);
      let vaultTokenBalance = await Dai.balanceOf(vault.address);
      expect(vaultTokenBalance).to.equal(expectedVaultBalance);
    });
    it("should reduce user investment balance if successfull", async () => {
      let expectedUserBalance = BigNumber.from("4900000000000000000000"); //  4900
      let userInvestment = await compoundController
        .connect(signer)
        ._getUserInvestment(signer.address, 2);
      expect(userInvestment.tokenAmount).to.equal(expectedUserBalance);
    });
    it("should increase user vault token balance if successfull", async () => {
      let expectedUserVaultBalance = BigNumber.from("150000000000000000000"); //  150
      let userVault = await vault
        .connect(signer)
        ._getUserVault(signer.address, DAI);
      expect(userVault.totalAmount).to.equal(expectedUserVaultBalance);
    });
  });
});
