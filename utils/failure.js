// One place to answer a failed database call.
//
// Routes used to return the Supabase error verbatim —
// `res.status(400).json({ error: error.message })` — which handed the
// client whatever Postgres said. That text names tables, columns and
// constraints: "duplicate key value violates unique constraint
// users_email_key" tells an anonymous caller the table name, the column,
// and the constraint naming convention. Sixty-one routes did this.
//
// The underlying error is still logged in full server-side, so nothing is
// lost for debugging; only the client's copy is replaced.
//
// Not a middleware: the caller knows which operation failed and what to
// call it, and a generic handler would have to guess.
function fail(res, status, message, cause) {
  if (cause) console.error(message, cause)
  return res.status(status).json({ error: message })
}

module.exports = { fail }
