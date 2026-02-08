import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorDice2024 } from "../target/types/anchor_dice_2024";
import { expect, assert } from "chai";

describe("Dice Betting Protocol Test", () => {
  // Configure the client to use the local cluster.

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conection = provider.connection;
  const program = anchor.workspace.AnchorDice2024 as Program<AnchorDice2024>;

  const house = provider.wallet;
  let player = anchor.web3.Keypair.generate();

  let seed = new anchor.BN(24525);
  const [vaultPda, vaultPdaBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), house.publicKey.toBuffer()],
    program.programId
  );

  const [betPda, betPdaBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("bet"),
      vaultPda.toBuffer(),
      seed.toArrayLike(Buffer, "le", 16),
    ],
    program.programId
  );

  before(async () => {
    await provider.connection.requestAirdrop(
      player.publicKey,
      100 * anchor.web3.LAMPORTS_PER_SOL
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("Initialize Betting Protocol !", async () => {
    const protocolInitialDeposit = new anchor.BN(
      40 * anchor.web3.LAMPORTS_PER_SOL
    );
    const tx = await program.methods
      .initialize(protocolInitialDeposit)
      .accountsStrict({
        house: house.publicKey,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);

    expect(vaultBalance).greaterThan(Number(new anchor.BN(40)));
  });

  it("Cannot place a bet of a roll less than 2 !", async () => {
    const betAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    try {
      const tx = await program.methods
        .placeBet(seed, 1, betAmount)
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault: vaultPda,
          bet: betPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "MinimumRoll");
    }
  });

  it("Cannot place a bet of a roll more than 96 !", async () => {
    const betAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    try {
      const tx = await program.methods
        .placeBet(seed, 99, betAmount)
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault: vaultPda,
          bet: betPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "MaximumRoll");
    }
  });

  it("Cannot place a bet with amount lower than 0.01!", async () => {
    const betAmount = new anchor.BN(
      0.0000000000000000000000000000001 * anchor.web3.LAMPORTS_PER_SOL
    );
    try {
      const tx = await program.methods
        .placeBet(seed, 3, betAmount)
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault: vaultPda,
          bet: betPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "MinimumBet");
    }
  });

  it("Cannot place a bet with amount higher than protocols balance!", async () => {
    const betAmount = new anchor.BN(70 * anchor.web3.LAMPORTS_PER_SOL);
    try {
      const tx = await program.methods
        .placeBet(seed, 30, betAmount)
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault: vaultPda,
          bet: betPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "MaximumBet");
    }
  });
  it("Place a Bet the Protocol !", async () => {
    const betAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const beforeVaultBalance = await provider.connection.getBalance(vaultPda);
    const tx = await program.methods
      .placeBet(seed, 6, betAmount)
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        vault: vaultPda,
        bet: betPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);

    expect(vaultBalance).eq(beforeVaultBalance + Number(betAmount));
  });

  it("Cannot refund a Bet because time is not elapsed !", async () => {
    try {
      const tx = await program.methods
        .refundBet()
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault: vaultPda,
          bet: betPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    } catch (error) {
      const err = anchor.AnchorError.parse(error.logs);
      assert.strictEqual(err.error.errorCode.code, "TimeoutNotReached");
    }
  });

  it("Resolve a bet", async () => {
    const accountInfo = await provider.connection.getAccountInfo(betPda);
    const message = accountInfo.data.subarray(8);
    let signature = anchor.web3.Ed25519Program.createInstructionWithPrivateKey({
      privateKey: (house.payer as anchor.web3.Keypair).secretKey,
      message: message,
    });

    const resolve_tx = await program.methods
      .resolveBet(
        Buffer.from(signature.data.buffer.slice(16 + 32, 16 + 32 + 64))
      )
      .accountsStrict({
        house: house.publicKey,
        player: player.publicKey,
        vault: vaultPda,
        bet: betPda,
        instructionSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([house.payer])
      .instruction();

    const tx = new anchor.web3.Transaction().add(signature).add(resolve_tx);

    try {
      await anchor.web3.sendAndConfirmTransaction(conection, tx, [house.payer]);
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

  it("Refund a bet !", async () => {
    const betAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const beforeUserBalance = await provider.connection.getBalance(
      player.publicKey
    );
    const beforeVaultBalance = await provider.connection.getBalance(vaultPda);
    await program.methods
      .placeBet(seed, 6, betAmount)
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        vault: vaultPda,
        bet: betPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([player])
      .rpc();
    await new Promise((resolve) => setTimeout(resolve, 7500));

    await program.methods
      .refundBet()
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        vault: vaultPda,
        bet: betPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    
   
  });
});
