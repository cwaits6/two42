-- Calendar subscription tokens were stored in plaintext and never expired
-- Move to a hashed-at-rest token with a sliding expiry, and
-- add the RLS policy needed for users to rotate (regenerate) their own
-- token. Existing plaintext tokens are treated as compromised — everyone's
-- row is cleared, and a fresh hashed token is minted lazily the next time
-- they use "Subscribe to Calendar" or "Subscribe to Event".

alter table public.calendar_subscription_tokens
  add column token_hash text,
  add column expires_at timestamptz;

delete from public.calendar_subscription_tokens;

alter table public.calendar_subscription_tokens
  drop column token,
  alter column token_hash set not null,
  alter column expires_at set not null,
  add constraint calendar_subscription_tokens_token_hash_key unique (token_hash);

create policy "Members can update own subscription token"
  on public.calendar_subscription_tokens for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
