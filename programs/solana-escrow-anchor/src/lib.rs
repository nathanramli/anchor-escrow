use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, SetAuthority, Token, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod solana_escrow_anchor {
    use super::*;

    const ESCROW_PDA_SEEDS: &[u8] = b"escrow";

    pub fn initialize(
        ctx: Context<Initialize>,
        initializer_amount: u64,
        taker_amount: u64,
    ) -> ProgramResult {
        ctx.accounts.escrow_account.initializer_key = *ctx.accounts.initializer.key;
        ctx.accounts
            .escrow_account
            .initializer_deposit_token_account = *ctx
            .accounts
            .initializer_deposit_token_account
            .to_account_info()
            .key;
        ctx.accounts
            .escrow_account
            .initializer_receive_token_account = *ctx
            .accounts
            .initializer_receive_token_account
            .to_account_info()
            .key;

        ctx.accounts.escrow_account.initializer_amount = initializer_amount;
        ctx.accounts.escrow_account.taker_amount = taker_amount;

        let (pda, _bump) = Pubkey::find_program_address(&[ESCROW_PDA_SEEDS], ctx.program_id);
        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(pda),
        )?;

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> ProgramResult {
        let (_pda, bump_seed) = Pubkey::find_program_address(&[ESCROW_PDA_SEEDS], ctx.program_id);
        let seeds = &[&ESCROW_PDA_SEEDS[..], &[bump_seed]];

        token::transfer(
            ctx.accounts
                .into_transfer_context()
                .with_signer(&[&seeds[..]]),
            ctx.accounts.escrow_account.initializer_amount,
        )?;

        token::close_account(
            ctx.accounts
                .close_account_context()
                .with_signer(&[&seeds[..]]),
        )?;

        token::close_account(ctx.accounts.close_receiver_account_context())?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(initializer_amount: u64)]
pub struct Initialize<'info> {
    #[account(signer, mut)]
    pub initializer: AccountInfo<'info>,
    #[account(init, payer = initializer, space = 8 + EscrowAccount::LEN)]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        mut,
        constraint = initializer_deposit_token_account.amount >= initializer_amount
    )]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    pub initializer_receive_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(signer, mut)]
    pub initializer: AccountInfo<'info>,
    #[account(
        mut,
        constraint = escrow_account.initializer_key == initializer.key(),
        constraint = escrow_account.initializer_deposit_token_account == initializer_deposit_token_account.key(),
        constraint = escrow_account.initializer_receive_token_account == initializer_receive_token_account.key(),
        close = initializer
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub initializer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initializer_receive_token_account: Account<'info, TokenAccount>,
    pub pda: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct EscrowAccount {
    pub initializer_key: Pubkey,
    pub initializer_deposit_token_account: Pubkey,
    pub initializer_receive_token_account: Pubkey,
    pub initializer_amount: u64,
    pub taker_amount: u64,
}

impl EscrowAccount {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8;
}

impl<'info> Initialize<'info> {
    pub fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            current_authority: self.initializer.clone(),
            account_or_mint: self
                .initializer_deposit_token_account
                .to_account_info()
                .clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

impl<'info> Cancel<'info> {
    pub fn into_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            authority: self.pda.clone(),
            from: self
                .initializer_deposit_token_account
                .to_account_info()
                .clone(),
            to: self.initializer_token_account.to_account_info().clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    pub fn close_account_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self
                .initializer_deposit_token_account
                .to_account_info()
                .clone(),
            authority: self.pda.clone(),
            destination: self.initializer.clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    pub fn close_receiver_account_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self
                .initializer_receive_token_account
                .to_account_info()
                .clone(),
            authority: self.initializer.clone(),
            destination: self.initializer.clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}
