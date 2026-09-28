// Creates (or refreshes) the dummy auction operator account and grants it operator rights.
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, nodeClient, requireEnv } from './env.mjs'

const admin = nodeClient(requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

async function findUserByEmail(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((u) => u.email === email)
    if (user) return user
    if (data.users.length < 200) return null
  }
  return null
}

let user = await findUserByEmail(OPERATOR_EMAIL)
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: OPERATOR_PASSWORD,
    email_confirm: true,
  })
  if (error) throw error
  console.log(`Updated existing operator account ${OPERATOR_EMAIL}`)
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: 'Auction Operator (demo)' },
  })
  if (error) throw error
  user = data.user
  console.log(`Created operator account ${OPERATOR_EMAIL}`)
}

const { error } = await admin
  .from('operators')
  .upsert({ user_id: user.id, display_name: 'Auction Operator (demo)' })
if (error) throw error
console.log('Operator rights granted.')
