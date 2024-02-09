/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CatalogBuilder } from '@backstage/plugin-catalog-backend';
import { ScaffolderEntitiesProcessor } from '@backstage/plugin-catalog-backend-module-scaffolder-entity-model';
import { UnprocessedEntitiesModule } from '@backstage/plugin-catalog-backend-module-unprocessed';
import { Router } from 'express';
import { PluginEnvironment } from '../types';
import { DemoEventBasedEntityProvider } from './DemoEventBasedEntityProvider';
import { GGroupsEntityProvider } from '@backstage/plugin-catalog-backend-module-ggroups-entity-provider';

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  const builder = await CatalogBuilder.create(env);
  builder.addProcessor(new ScaffolderEntitiesProcessor());

  const ggroupsProvider = new GGroupsEntityProvider(
    env.logger,
    env.config,
  );

  builder.addEntityProvider(ggroupsProvider);

  const demoProvider = new DemoEventBasedEntityProvider({
    logger: env.logger,
    topics: ['example'],
    eventBroker: env.eventBroker,
  });
  builder.addEntityProvider(demoProvider);

  const { processingEngine, router } = await builder.build();

  const unprocessed = new UnprocessedEntitiesModule(
    await env.database.getClient(),
    router,
  );
  unprocessed.registerRoutes();
  await processingEngine.start();

  await env.scheduler.scheduleTask({
    id: 'ggroups_sync',
    fn: async () => {
      await ggroupsProvider.run();
    },
    frequency: { minutes: 30 },
    timeout: { minutes: 10 },
  });

  return router;
}
