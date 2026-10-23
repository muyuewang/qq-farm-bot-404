import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

export function mountPetDiaryRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/pet-diary', 'getPetDiary');
    app.get('/api/activity-center/pet-diary/records', withAccount((id, req: Request) => ctx.provider.getPetDiaryRecords(id, req.query.kind)));
    app.get('/api/activity-center/pet-diary/friend', withAccount((id, req: Request) => ctx.provider.getPetDiaryFriend(id, req.query.gid)));
    app.post('/api/activity-center/pet-diary/operate', withAccount((id, req: Request) => ctx.provider.operatePetDiary(id, req.body?.action, req.body?.params)));
}
