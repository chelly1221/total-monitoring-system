// Finish connection initialization before the server accepts API requests.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prismaReady } = await import('@/lib/db')
    await prismaReady
  }
}
