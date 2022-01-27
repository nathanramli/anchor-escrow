import * as anchor from '@project-serum/anchor';
import { Program, BN } from '@project-serum/anchor';
import { Token, TOKEN_PROGRAM_ID, } from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaEscrowAnchor } from '../target/types/solana_escrow_anchor';
import { assert } from "chai";
import { encode } from '@project-serum/anchor/dist/cjs/utils/bytes/utf8';

describe('solana-escrow-anchor', () => {

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());
  const provider = anchor.Provider.env();

  const program = anchor.workspace.SolanaEscrowAnchor as Program<SolanaEscrowAnchor>;
  const ESCROW_SEEDS = "escrow"

  const alice = Keypair.generate()
  const bob = Keypair.generate()

  const minter = Keypair.generate()

  const escrowAccount = Keypair.generate()

  let pda: PublicKey = null;

  let mintA: Token = null;
  let mintB: Token = null;
  let aliceTokenAccountA: PublicKey = null;
  let aliceTokenAccountB: PublicKey = null;
  let bobTokenAccountA: PublicKey = null;
  let bobTokenAccountB: PublicKey = null;

  let vaultTokenAccount: PublicKey = null;

  const INIT_AMOUNT_TOKEN_A = 50;
  const INIT_AMOUNT_TOKEN_B = 50;

  const OFFERED_AMOUNT_A = 20;
  const REQUESTED_AMOUNT_B = 25;

  const initializeTransaction = async () => {
    vaultTokenAccount = await mintA.createAccount(alice.publicKey)
    aliceTokenAccountB = await mintB.createAccount(alice.publicKey)
    bobTokenAccountA = await mintA.createAccount(bob.publicKey)

    await mintA.transfer(
      aliceTokenAccountA,
      vaultTokenAccount,
      alice.publicKey,
      [alice],
      OFFERED_AMOUNT_A
    )

    const txHash = await program.rpc.initialize(
      new BN(OFFERED_AMOUNT_A),
      new BN(REQUESTED_AMOUNT_B),
      {
        accounts: {
          initializer: alice.publicKey,
          escrowAccount: escrowAccount.publicKey,
          vaultTokenAccount: vaultTokenAccount,
          initializerReceiveTokenAccount: aliceTokenAccountB,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [escrowAccount, alice]
      })

    const [pdaTemp, _bump] = await PublicKey.findProgramAddress(
      [Buffer.from(encode(ESCROW_SEEDS))],
      program.programId
    )
    pda = pdaTemp
    return txHash
  }

  it('Setup', async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(minter.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(alice.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(bob.publicKey, 1e9));

    mintA = await Token.createMint(
      provider.connection,
      minter,
      minter.publicKey,
      null,
      0,
      TOKEN_PROGRAM_ID,
    )

    mintB = await Token.createMint(
      provider.connection,
      minter,
      minter.publicKey,
      null,
      0,
      TOKEN_PROGRAM_ID,
    )

    aliceTokenAccountA = await mintA.createAccount(alice.publicKey)
    bobTokenAccountB = await mintB.createAccount(bob.publicKey)

    await mintA.mintTo(
      aliceTokenAccountA,
      minter.publicKey,
      [],
      INIT_AMOUNT_TOKEN_A
    )
    await mintB.mintTo(
      bobTokenAccountB,
      minter.publicKey,
      [],
      INIT_AMOUNT_TOKEN_B
    )

    const infoTokenAlice = await mintA.getAccountInfo(aliceTokenAccountA)
    assert.ok(infoTokenAlice.amount.toNumber() == INIT_AMOUNT_TOKEN_A)

    const infoTokenBob = await mintB.getAccountInfo(bobTokenAccountB)
    assert.ok(infoTokenBob.amount.toNumber() == INIT_AMOUNT_TOKEN_B)
  });

  it('Init and Cancel', async () => {
    const init = await initializeTransaction()

    const sign = await program.rpc.cancel({
      accounts: {
        initializer: alice.publicKey,
        escrowAccount: escrowAccount.publicKey,
        initializerTokenAccount: aliceTokenAccountA,
        vaultTokenAccount: vaultTokenAccount,
        initializerReceiveTokenAccount: aliceTokenAccountB,
        pda: pda,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [alice]
    })

    const escrowAccountInfo = await provider.connection.getAccountInfo(escrowAccount.publicKey);
    assert.ok(escrowAccountInfo === null)

    const infoTokenAlice = await mintA.getAccountInfo(aliceTokenAccountA)
    assert.ok(infoTokenAlice.amount.toNumber() == INIT_AMOUNT_TOKEN_A)

    const infoTokenBob = await mintB.getAccountInfo(bobTokenAccountB)
    assert.ok(infoTokenBob.amount.toNumber() == INIT_AMOUNT_TOKEN_B)
  })

  it('Initalize escrow', async () => {
    const sign = await initializeTransaction()

    const vaultInfo = await mintA.getAccountInfo(vaultTokenAccount)
    assert.ok(vaultInfo.owner.equals(pda))

    const escrowData = await program.account.escrowAccount.fetch(escrowAccount.publicKey)
    assert.ok(escrowData.initializerAmount.toNumber() === OFFERED_AMOUNT_A)
    // Use .equals for comparing public key
    assert.ok(escrowData.vaultTokenAccount.equals(vaultTokenAccount))
    assert.ok(escrowData.initializerReceiveTokenAccount.equals(aliceTokenAccountB))
    assert.ok(escrowData.takerAmount.toNumber() === REQUESTED_AMOUNT_B)
    assert.ok(escrowData.initializerKey.equals(alice.publicKey))
  });

  it('Exchange', async () => {
    const sign = await program.rpc.exchange({
      accounts: {
        taker: bob.publicKey,
        initializer: alice.publicKey,
        takerReceiveTokenAccount: bobTokenAccountA,
        takerSendTokenAccount: bobTokenAccountB,
        escrowAccount: escrowAccount.publicKey,
        vaultTokenAccount: vaultTokenAccount,
        initializerReceiveTokenAccount: aliceTokenAccountB,
        pda: pda,
        tokenProgram: TOKEN_PROGRAM_ID
      },
      signers: [bob]
    })

    const bobTokenAccountAInfo = await mintA.getAccountInfo(bobTokenAccountA)
    assert.ok(bobTokenAccountAInfo.amount.toNumber() === OFFERED_AMOUNT_A)

    const bobTokenAccountBInfo = await mintB.getAccountInfo(bobTokenAccountB)
    assert.ok(bobTokenAccountBInfo.amount.toNumber() === INIT_AMOUNT_TOKEN_B - REQUESTED_AMOUNT_B)

    const aliceTokenAccountAInfo = await mintA.getAccountInfo(aliceTokenAccountA)
    assert.ok(aliceTokenAccountAInfo.amount.toNumber() === INIT_AMOUNT_TOKEN_A - OFFERED_AMOUNT_A)

    const aliceTokenAccountBInfo = await mintB.getAccountInfo(aliceTokenAccountB)
    assert.ok(aliceTokenAccountBInfo.amount.toNumber() === REQUESTED_AMOUNT_B)
  });
});
