const DISCORD_API = 'https://discord.com/api/v10'
const BOT_TOKEN = process.env.DISCORD_TOKEN

// แปะยศให้ user ใน guild
export async function assignRole(guildId, userId, roleId) {
  const url = `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Discord assign role failed: ${res.status}`, body)
    throw new Error(`Failed to assign role: ${res.status}`)
  }
}
