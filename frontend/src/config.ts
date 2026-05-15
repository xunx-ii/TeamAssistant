import adminConfig from '../admin.json'

export async function loadAdminQQs(): Promise<string[]> {
  return (adminConfig as { adminQQs?: string[] }).adminQQs ?? []
}
