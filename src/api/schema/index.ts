import { Hono } from 'hono'
import type { Env } from '../../types'
import forms from './forms'

const schema = new Hono<{ Bindings: Env }>()

schema.route('/forms', forms)

export default schema
