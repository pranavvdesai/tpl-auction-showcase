// Supabase Auth signs in with an email address; operators type a plain username instead.
// ".invalid" is a reserved domain, so no auth email can ever be delivered anywhere.
export const USERNAME_EMAIL_DOMAIN = 'tpl-auction.invalid'

export function loginEmail(usernameOrEmail: string): string {
  const value = usernameOrEmail.trim().toLowerCase()
  return value.includes('@') ? value : `${value}@${USERNAME_EMAIL_DOMAIN}`
}

export function displayUsername(email: string | undefined): string {
  if (!email) return 'operator'
  return email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`) ? email.slice(0, -USERNAME_EMAIL_DOMAIN.length - 1) : email
}
