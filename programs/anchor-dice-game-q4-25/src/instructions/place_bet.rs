use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};


use crate::{errors::DiceError, state::Bet};

#[derive(Accounts)]
#[instruction(seed:u128)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    ///CHECK: This is safe
    pub house: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = player,
        space = Bet::DISCRIMINATOR.len() + Bet::INIT_SPACE,
        seeds = [b"bet", vault.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBet<'info> {
    pub fn create_bet(
        &mut self,
        bumps: &PlaceBetBumps,
        seed: u128,
        roll: u8,
        amount: u64,
    ) -> Result<()> {
        require!(roll > 2, DiceError::MinimumRoll);
        require!(roll < 96, DiceError::MaximumRoll);


        let current_protocol_balance = self.house.to_account_info().lamports();
        require!(amount as f32 > 0.01, DiceError::MinimumBet);
        require!(amount < current_protocol_balance, DiceError::MaximumBet);
        self.bet.set_inner(Bet {
            slot: Clock::get()?.slot,
            player: self.player.key(),
            seed,
            roll,
            amount,
            bump: bumps.bet,
        });
        Ok(())
    }

    pub fn deposit(&mut self, amount: u64) -> Result<()> {
        
        require!(self.player.to_account_info().lamports() >= amount,  DiceError::InsufficientFunds);
       
        let accounts = Transfer {
            from: self.player.to_account_info(),
            to: self.vault.to_account_info(),
        };

        let ctx = CpiContext::new(self.system_program.to_account_info(), accounts);
        transfer(ctx, amount)
    }
}
