# @backstage/plugin-catalog-backend-module-ggroups-entity-provider

`ggroups-entity-provider` backend module for the catalog plugin.

`ggroups-entity-provider` syncs groups and members taken from Google Workspace groups as catalog entities (User, Group). 

```diff
// app-config.yaml

stackstorm:
  webUrl: https://your.stackstorm.webui.instance.com

permission:
  enabled: true

+ google:
+  providers:
+   ggroups:
+    customerId: C12nfslfo #Google Workspace account customerId
+    groups: [org-backstage-dev@org-backstage.com, org-backstage-test@org-backstage.com] # Specific Google Workspace groups addresses to sync:
```

To sync all groups found for customerId:

```diff
// app-config.yaml

stackstorm:
  webUrl: https://your.stackstorm.webui.instance.com

permission:
  enabled: true

+ google:
+  providers:
+   ggroups:
+    customerId: C12nfslfo #Google Workspace account customerId
+    groups: [] # Sync all Google Workspace groups of customerId
```

To sync groups based on a query expressions. See [Documentation](https://developers.google.com/admin-sdk/directory/v1/guides/search-groups):

```diff
// app-config.yaml

stackstorm:
  webUrl: https://your.stackstorm.webui.instance.com

permission:
  enabled: true

+ google:
+  providers:
+   ggroups:
+    customerId: C12nfslfo #Google Workspace account customerId
+    query: [email:org-temp*, name:temp*] # Sync Google Workspace groups that match AND joined query expression
+    # See docs: https://developers.google.com/admin-sdk/directory/v1/guides/search-groups
```


```diff
// packages/backend/src/plugins/catalog.ts

+import { GGroupsEntityProvider } from '@backstage/plugin-catalog-backend-module-ggroups-entity-provider';

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  const builder = await CatalogBuilder.create(env);
  builder.addProcessor(new ScaffolderEntitiesProcessor());

+  const ggroupsProvider = new GGroupsEntityProvider(
+    env.logger,
+    env.config,
+    env.scheduler,
+  );

+  builder.addEntityProvider(ggroupsProvider);


 await processingEngine.start();

+  await env.scheduler.scheduleTask({
+    id: 'ggroups_sync',
+    fn: async () => {
+     await ggroupsProvider.run();
+    },
+    frequency: { minutes: 60 },
+    timeout: { minutes: 10 },
+  });

```
