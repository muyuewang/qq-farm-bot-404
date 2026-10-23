import type { Application } from 'express';
import type { AdminContext } from '../context';
import { mountCharityActivityRoutes } from './charity-routes';
import { createActivityRouteContext } from './context';
import { mountActivityOverviewRoutes } from './overview-routes';
import { mountQingMeiActivityRoutes } from './qingmei-routes';
import { mountQixiActivityRoutes } from './qixi-routes';
import { mountStellarActivityRoutes } from './stellar-routes';
import { mountWeatherActivityRoutes } from './weather-routes';
import { mountPetDiaryRoutes } from './pet-diary-routes';

function mountActivityCenterRoutes(app: Application, ctx: AdminContext): void {
    const routes = createActivityRouteContext(app, ctx);
    mountActivityOverviewRoutes(routes);
    mountStellarActivityRoutes(routes);
    mountQingMeiActivityRoutes(routes);
    mountQixiActivityRoutes(routes);
    mountCharityActivityRoutes(routes);
    mountWeatherActivityRoutes(routes);
    mountPetDiaryRoutes(routes);
}

module.exports = { mountActivityCenterRoutes };
