import { q } from '@/lib/db';
import { dt } from '@/lib/format';
import { sendMessageAction } from '@/app/actions/jobs';

/** Чат по поръчка или заявка. Достъпът е проверен от страницата, която го показва. */
export async function Chat({ orderId, requestId, userId }: { orderId?: string; requestId?: string; userId: string }) {
  const rows = await q(`select m.id, m.body, m.system, m.sender_id, m.created_at, p.display_name from messages m join profiles p on p.user_id=m.sender_id
     where ${orderId ? 'm.order_id=$1' : 'm.request_id=$1'} order by m.id`, [orderId ?? requestId]);
  await q(`update messages set read_at=now() where ${orderId ? 'order_id=$1' : 'request_id=$1'} and sender_id<>$2 and read_at is null`, [orderId ?? requestId, userId]);
  return (
    <section className="card space-y-3">
      <h2 className="font-display text-lg">Чат</h2>
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {rows.map((m: any) => m.system
          ? <p key={m.id} className="text-center text-xs text-slate-500">{m.body}</p>
          : <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.sender_id === userId ? 'self-end bg-teal-soft text-slate-900' : 'self-start bg-slate-100 text-slate-900'}`}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p><p className="mt-1 text-[11px] text-slate-500">{m.display_name} · {dt(m.created_at)}</p></div>)}
      </div>
      <form action={sendMessageAction} className="flex gap-2">
        {orderId && <input type="hidden" name="orderId" value={orderId} />}{requestId && <input type="hidden" name="requestId" value={requestId} />}
        <input name="body" className="input" required maxLength={2000} placeholder="Съобщение" aria-label="Съобщение" autoComplete="off" />
        <button className="btn btn-primary">Изпрати</button>
      </form>
    </section>
  );
}
