// Every in-app notification is mirrored to the member's devices. Push is a
// courtesy: it must never throw, and a device that unsubscribed is dropped.

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))
const mockSend = jest.fn()
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSend(...args),
}))

function chain(result) {
  const builder = {}
  ;['select', 'in', 'eq', 'delete'].forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

function loadPush(withKeys) {
  jest.resetModules()
  if (withKeys) {
    process.env.VAPID_PUBLIC_KEY = 'public'
    process.env.VAPID_PRIVATE_KEY = 'private'
  } else {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  }
  return require('../utils/push')
}

beforeEach(() => { mockFrom.mockReset(); mockSend.mockReset() })
afterAll(() => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY })

test('tapping goes where the bell menu goes', () => {
  const { pushUrl } = loadPush(false)
  expect(pushUrl({ type: 'class_started', class_session_id: 9 })).toBe('/classroom/9')
  expect(pushUrl({ type: 'request_fulfilled' })).toBe('/classes')
  expect(pushUrl({ type: 'credit_added' })).toBe('/dashboard')
})

test('without keys nothing is read or sent', async () => {
  const { pushNotifications } = loadPush(false)
  await expect(pushNotifications([{ user_id: 1, type: 'credit_added', message: 'hi' }])).resolves.toBe(0)
  expect(mockFrom).not.toHaveBeenCalled()
})

test('sends to each of the member\'s devices and forgets a gone one', async () => {
  const { pushNotifications } = loadPush(true)
  const subs = chain({ data: [
    { id: 1, user_id: 5, endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' },
    { id: 2, user_id: 5, endpoint: 'https://push.example/b', p256dh: 'k', auth: 'a' },
    { id: 3, user_id: 6, endpoint: 'https://push.example/c', p256dh: 'k', auth: 'a' },
  ], error: null })
  const removal = chain({ error: null })
  mockFrom.mockReturnValueOnce(subs).mockReturnValueOnce(removal)
  mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))

  const sent = await pushNotifications([{ user_id: 5, type: 'credit_added', message: 'You got a banana.' }])

  expect(sent).toBe(1)
  expect(mockSend).toHaveBeenCalledTimes(2)
  expect(JSON.parse(mockSend.mock.calls[0][1])).toMatchObject({ body: 'You got a banana.', url: '/dashboard' })
  expect(removal.eq).toHaveBeenCalledWith('id', 2)
})

test('a failing read does not throw', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const { pushNotifications } = loadPush(true)
  mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'relation "push_subscriptions" does not exist' } }))
  await expect(pushNotifications([{ user_id: 5, type: 'credit_added', message: 'x' }])).resolves.toBe(0)
  spy.mockRestore()
})
