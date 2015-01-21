//   Copyright 2013-2014 François de Campredon
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

'use strict';

declare var global: any;
// inject global in the worker
global.window = self;


import projectService = require('typescript-project-services');
import WorkerBridge = require('../main/workerBridge');
import Promise = require('bluebird');

var bridge = new WorkerBridge(<any>self);

//expose the worker services
bridge.init(projectService).then(proxy => {
    self.console = proxy.console;
    return Promise.all([
        proxy.getTypeScriptLocation(),
        proxy.preferencesManager.getProjectsConfig()
    ])
    .then(result => {
        projectService.init({
            defaultTypeScriptLocation: <any>result[0],
            fileSystem: proxy.fileSystem,
            workingSet: proxy.workingSet,
            projectConfigs: <any>result[1]
        });     
        proxy.preferencesManager.configChanged(() => {
            proxy.preferencesManager.getProjectsConfig().then((config: any) => {
                projectService.updateProjectConfigs(config);
            })
        })
    })
});
