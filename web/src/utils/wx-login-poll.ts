let pollTail: Promise<void> = Promise.resolve()

export async function runWxLoginStatusPoll<T>(operation: () => Promise<T>): Promise<T> {
  const previous = pollTail
  let release!: () => void
  pollTail = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous.catch(() => undefined)
  try {
    return await operation()
  }
  finally {
    release()
  }
}
