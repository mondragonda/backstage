/*
 * Copyright 2024 The Backstage Authors
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
import { Config } from '@backstage/config';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Logger } from 'winston';
import { admin_directory_v1, auth as AuthConfig } from '@googleapis/admin';
import path from 'path';
import { resolvePackagePath } from '@backstage/backend-common';
import packageinfo from '../package.json';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
  Entity,
  GroupEntity,
  UserEntity,
} from '@backstage/catalog-model';
import { kebabCase } from 'lodash';

/**
 * Catalog entity provider to sync users from Google Workspace groups with Backstage users
 * @public
 */
export class GGroupsEntityProvider implements EntityProvider {
  private readonly logger: Logger;
  private readonly config: Config;
  private connection?: EntityProviderConnection;
  private directoryApiClient?: admin_directory_v1.Admin;

  constructor(logger: Logger, config: Config) {
    this.logger = logger;
    this.config = config;
    this.initializeGoogleApiClient();
  }

  private async initializeGoogleApiClient(): Promise<void> {
    const auth = await AuthConfig.getClient({
      keyFile: path.join(resolvePackagePath(packageinfo.name), '/key.json'),
      scopes: [
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
      ],
    });
    this.directoryApiClient = new admin_directory_v1.Admin({
      auth,
    });
  }

  getProviderName(): string {
    return 'ggroups';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async run(): Promise<void> {
    let error: Error;

    if (!this.connection) {
      error = new Error('Provider connection not initialized.');
      this.logger.error(error);
      throw error;
    }

    if (!this.directoryApiClient) {
      error = new Error(
        'Google Admin SDK Directory API client not initialized.',
      );
      this.logger.error(error);
      throw error;
    }

    let customerIdConfig: string;

    try {
      customerIdConfig = this.config.getString(
        'google.providers.ggroups.customerId',
      );
    } catch (configError) {
      this.logger.error(configError);
      throw configError;
    }

    const groupsConfig = this.config.getOptionalStringArray(
      'google.providers.ggroups.groups',
    );

    const queryConfig = this.config.getOptionalStringArray(
      'google.providers.ggroups.query'
    )

    if (groupsConfig && queryConfig) {
      error = new Error('Neither google.providers.ggroups.groups or google.providers.ggroups.query are defined as config values.');
      this.logger.error(error);
      throw error;
    }

    if (queryConfig && queryConfig.length === 0) {
      error = new Error('google.providers.ggroups.query array has no query expressions defined.');
      this.logger.error(error);
      throw error;
    }

    let groupsResponse: any;
    let ggroups: admin_directory_v1.Schema$Group[] = [];

    if (!queryConfig) {
      groupsResponse = await this.directoryApiClient.groups.list({
        customer: customerIdConfig,
      });
      ggroups = groupsResponse.data.groups as admin_directory_v1.Schema$Group[];
    } else {
      for (const query of queryConfig) {
        groupsResponse = await this.directoryApiClient.groups.list({
          customer: customerIdConfig,
          query
        });
        ggroups = [...ggroups, ...Array.isArray(groupsResponse.data.groups) ? groupsResponse.data.groups as admin_directory_v1.Schema$Group[] : []]
      }
    }

    if (groupsConfig) {
      ggroups = ggroups?.filter((ggroup) => groupsConfig?.includes(ggroup.email as string));
    }

    const entities: Entity[] = [];

    for (const ggroup of ggroups || []) {

      const groupEntity: GroupEntity = {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: {
          uid: ggroup.id as string,
          name: kebabCase(ggroup.name as string),
          description: ggroup.description as string,
          tags: ['google-groups'],
          annotations: {
            [ANNOTATION_LOCATION]: `ggroups:${groupsResponse.request.responseURL}`,
            [ANNOTATION_ORIGIN_LOCATION]: `ggroups:${groupsResponse.request.responseURL}`,
          },
        },
        spec: {
          type: 'team',
          profile: {
            displayName: ggroup.name as string,
            email: ggroup.email as string,
          },
          members: [],
          children: [],
        },
      };

      const ggroupMembersResponse = await this.directoryApiClient.members.list({
        groupKey: ggroup.id as string,
      });

      for (const ggroupMember of ggroupMembersResponse.data.members || []) {
        const userEntity: UserEntity = {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'User',
          metadata: {
            uid: ggroupMember.id as string,
            name: (ggroupMember.email as string).split('@')[0],
            tags: ['google-groups'],
            annotations: {
              [ANNOTATION_LOCATION]: `ggroups:${groupsResponse.request.responseURL}`,
              [ANNOTATION_ORIGIN_LOCATION]: `ggroups:${groupsResponse.request.responseURL}`,
            },
          },
          spec: {
            profile: {
              email: ggroupMember.email as string,
            },
            memberOf: [groupEntity.metadata.name],
          },
        };

        groupEntity.spec.members?.push(userEntity.metadata.name);
        entities.push(userEntity);
      }
      entities.push(groupEntity);

      await new Promise<void>((resolve) => {
        const resume = (timeout: NodeJS.Timeout) => {
          clearTimeout(timeout);
          resolve();
        }
        const timeout = setTimeout(() => {
          resume(timeout);
        }, 1000);
      });
      
    }

    if (entities.length === 0) {
      return;
    }

    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: entity.metadata.annotations?.[ANNOTATION_LOCATION],
      })),
    });
  }
}
