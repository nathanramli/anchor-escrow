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

  const escrow_account = Keypair.generate()

  let mintA: Token = null;
  let mintB: Token = null;
  let aliceTokenAccountA = null;
  let bobTokenAccountB = null;

  let depositTokenAccount: PublicKey = null;
  let receiverTokenAccount: PublicKey = null;

  const INIT_AMOUNT_TOKEN_A = 50;
  const INIT_AMOUNT_TOKEN_B = 50;

  const OFFERED_AMOUNT_A = 20;
  const REQUESTED_AMOUNT_B = 25;

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

  it('Initalize escrow', async () => {
    depositTokenAccount = await mintA.createAccount(alice.publicKey)
    receiverTokenAccount = await mintB.createAccount(alice.publicKey)

    await mintA.transfer(
      aliceTokenAccountA,
      depositTokenAccount,
      alice.publicKey,
      [alice],
      OFFERED_AMOUNT_A
    )

    const sign = await program.rpc.initialize(
      new BN(OFFERED_AMOUNT_A),
      new BN(REQUESTED_AMOUNT_B),
      {
        accounts: {
          initializer: alice.publicKey,
          escrowAccount: escrow_account.publicKey,
          initializerDepositTokenAccount: depositTokenAccount,
          initializerReceiveTokenAccount: receiverTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [escrow_account, alice]
      })

    const [pda, _bump] = await PublicKey.findProgramAddress(
      [Buffer.from(encode(ESCROW_SEEDS))],
      program.programId
    )

    const depositInfo = await mintA.getAccountInfo(depositTokenAccount)
    assert.ok(depositInfo.owner.equals(pda))

    const escrowData = await program.account.escrowAccount.fetch(escrow_account.publicKey)
    assert.ok(escrowData.initializerAmount.toNumber() === OFFERED_AMOUNT_A)
    // Use .equals for comparing public key
    assert.ok(escrowData.initializerDepositTokenAccount.equals(depositTokenAccount))
    assert.ok(escrowData.initializerReceiveTokenAccount.equals(receiverTokenAccount))
    assert.ok(escrowData.takerAmount.toNumber() === REQUESTED_AMOUNT_B)
    assert.ok(escrowData.initializerKey.equals(alice.publicKey))
  });
});
