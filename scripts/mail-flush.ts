import { loadEnv } from '../lib/env';
loadEnv();
import { flushOutbox } from '../lib/mail';
import { pool } from '../lib/db';
flushOutbox().then((r) => { console.log(r); return pool().end(); });
