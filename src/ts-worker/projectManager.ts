import Rx = require('rx');
import path = require('path');
import vm = require('vm');
import fs = require('../commons/fileSystem');
import ws = require('../commons/workingSet');
import TypeScriptProjectConfig = require('../commons/config');
import collections = require('../commons/collections');
import tsUtils = require('../commons/typeScriptUtils');
import utils = require('../commons/utils');
import logger = require('../commons/logger');
import TypeScriptProject = require('./project');
import Services = TypeScript.Services;


//--------------------------------------------------------------------------
//
//  TypeScriptProjectManager
//
//--------------------------------------------------------------------------




/**
 * The main facade class of the extentions, responsible to create / destroy / update projects
 * by observing config files in the files of the opened brackets folder
 */
class TypeScriptProjectManager {
    
    //-------------------------------
    //  constructor
    //-------------------------------
    
    /**
     * @param fileSystem the fileSystem wrapper used by the projectManager
     * @param workingSet the working set wrapper used by the projectManager
     */
    constructor(
        private fileSystem: fs.FileSystem, 
        private workingSet: ws.WorkingSet,
        private defaultTypeScriptLocation: string,
        private projectFactory: (
            baseDirectory: string,
            config: TypeScriptProjectConfig, 
            fileSystem: fs.FileSystem,
            workingSet: ws.WorkingSet,
            servicesFactory: Services.TypeScriptServicesFactory,
            defaultLibLocation: string
        )  => TypeScriptProject
    ) {}
    
    //-------------------------------
    //  variables
    //-------------------------------
    
    /**
     * a map containing the projects 
     */
    private projectMap = new collections.StringMap<TypeScriptProject[]>();
    
    
    /**
     * 
     */
    private tempProject: TypeScriptProject;
    
    private disposable: Rx.IDisposable;
    
    private creatingProjects: JQueryPromise<void>
    
    //-------------------------------
    // Public methods
    //------------------------------- 
    
    
    /**
     * initialize the project manager
     */
    init(): JQueryPromise<void> {
        this.disposable = this.fileSystem.projectFilesChanged.subscribe(this.filesChangeHandler);
        var initializing = this.createProjects();
        this.creatingProjects = initializing;
        return initializing;
    }
    
    
    /**
     * dispose the project manager
     */
    dispose(): void {
        this.disposable.dispose(); 
        this.disposeProjects();
        
    }
    
    /**
     * this method will try to find a project referencing the given path
     * it will by priority try to retrive project that have that file as part of 'direct source'
     * before returning projects that just have 'reference' to this file
     * 
     * @param fileName the path of the typesrcript file for which project are looked fo
     */
    getProjectForFile(fileName: string): JQueryPromise<TypeScriptProject> {
        return this.creatingProjects.then(() => {
            var projects = utils.mergeAll(this.projectMap.values).filter(project => !!project),
                project : TypeScriptProject = null;
            //first we check for a project that have tha file as source 
            projects.some(tsProject => {
                if (tsProject.getProjectFileKind(fileName) === TypeScriptProject.ProjectFileKind.SOURCE) {
                    project = tsProject;
                    return true;
                }
            })     

            
            //then we check if a project has a file referencing the given file
            if (!project) {
                projects.some(tsProject => {
                    if (tsProject.getProjectFileKind(fileName) === TypeScriptProject.ProjectFileKind.REFERENCE) {
                        project = tsProject;
                        return true;
                    }
                });     
            }

            //then we check if the current temp project has the file
            if (!project) {
                if (this.tempProject && this.tempProject.getProjectFilesSet().has(fileName)) {
                    project = this.tempProject;
                } else {
                    this.tempProject.dispose();
                    this.tempProject = nu
                }
            }
            
            //then if still no project found we create the temp project
            if (!project) {
                var config: TypeScriptProjectConfig = utils.clone(tsUtils.typeScriptProjectConfigDefault);
                config.target = 'es5';
                config.sources = [fileName];
                this.tempProject = project = this.projectFactory(
                    '', 
                    config,  
                    this.fileSystem, 
                    this.workingSet,
                    new Services.TypeScriptServicesFactory(),
                    path.join(this.defaultTypeScriptLocation, 'lib.d.ts')
                );
            }
            
            return project;
        });
    }
    
    //-------------------------------
    //  Private methods
    //------------------------------- 
    
    /**
     * find bracketsTypescript config files and create a project for each file founds
     */
    private createProjects(): JQueryPromise<void> {
        return this.fileSystem.getProjectFiles().then(files => {
            return $.when.apply($,
                files
                    .filter(tsUtils.isTypeScriptProjectConfigFile)
                    .map(configFile => this.createProjectsFromFile(configFile))
            );
        });
    }
    
    /**
     * dispose every projects created by the project Manager
     */
    private disposeProjects():void {
        var projectMap = this.projectMap;
        projectMap.keys.forEach(path =>  {
            projectMap.get(path).forEach(project => project.dispose())
        });
        this.projectMap.clear();
        if (this.tempProject) {
            this.tempProject.dispose();
            this.tempProject = null;
        }
    }
    
    /**
     * for a given config file create a project
     * 
     * @param configFilePath the config file path
     */
    private createProjectsFromFile(configFilePath: string): JQueryPromise<void> {
        return this.retrieveConfig(configFilePath).then(configs => {
            if (configs.length === 0) {
                this.projectMap.delete(configFilePath);
                return;
            }
            
            var projects: TypeScriptProject[];
            if (this.projectMap.has(configFilePath)) {
                projects = this.projectMap.get(configFilePath);
                projects.forEach(project => project && project.dispose());
            }
            
            projects = [];
            this.projectMap.set(configFilePath, projects);

            return $.when.apply($,
                configs.map( (config: TypeScriptProjectConfig, index: number) => {
                    return this.createProjectFromConfig(configFilePath, config).then(project => {
                        projects[index] = project;
                    });
                })
            );
        });
    }
    
    /**
     * for given validated config and config file path create a project
     * 
     * @param configFilePath the config file path
     * @param config the config created from the file
     */
    private createProjectFromConfig(configFile: string, config : TypeScriptProjectConfig): JQueryPromise<TypeScriptProject> {
        var typescriptPath: string = config.typescriptPath || this.defaultTypeScriptLocation;
        return this.getTypeScriptInfosForPath(typescriptPath).then(factory => {
            var project = this.projectFactory(
                path.dirname(configFile), 
                config,  
                this.fileSystem, 
                this.workingSet,
                factory,
                path.join(typescriptPath, 'lib.d.ts')
            );
            return project.init().then(() => {
                return project;
            })
        }, (): TypeScriptProject => {
            if (logger.warning()) {
                logger.log('could not retrieve typescript service at path :' + typescriptPath)
            }
            return null;
        })
    }


    
    /**
     * try to create a config from a given config file path
     * validate the config file, then add default values if needed
     * 
     * @param configFilePath
     */
    private retrieveConfig(configFilePath: string): JQueryPromise<TypeScriptProjectConfig[]> {
        return this.fileSystem.readFile(configFilePath).then((content: string) => {
            var data : any;
            try {
                data =  JSON.parse(content);
            } catch(e) {
                if (logger.warning()) {
                    logger.log('invalid json for brackets-typescript config file: ' + configFilePath);
                }
            }
            
            if (!data) {
                return [];
            }
            
            var configs : TypeScriptProjectConfig[];
            if (Array.isArray(data)) {
                configs = data;
            } else {
                configs = [data]
            }
            
            return configs.map((config : TypeScriptProjectConfig, index: number) => {
                if(config) {
                    config = utils.assign(utils.clone(tsUtils.typeScriptProjectConfigDefault), config);
                    if(!tsUtils.validateTypeScriptProjectConfig(config)) {
                        if (logger.warning()) {
                            logger.log('invalid config file for brackets-typescript config file: ' +
                                configFilePath + ' with index : ' + index);
                        }
                        config = null;
                    }
                }
                return config; 
            }).filter(config => !!config);
        });
    }
    
    
    /**
     * Retrieve a ServiceFactory from a given typeScriptService file path
     * @param typescriptPath
     */
    private getTypeScriptInfosForPath(typescriptPath: string): JQueryPromise<TypeScript.Services.TypeScriptServicesFactory> {
        var typescriptServicesFile = path.join('typescriptPath', 'typescriptServices.js');
        var deferred = $.Deferred<TypeScript.Services.TypeScriptServicesFactory>()
        this.fileSystem.readFile(typescriptServicesFile).then(code => {
            var factory: TypeScript.Services.TypeScriptServicesFactory
            try {
                var context = vm.createContext();
                vm.runInNewContext(code, context, typescriptServicesFile);
                factory = (<any>context).TypeScript.Services.TypeScriptServicesFactory;
            } catch(e) {
                deferred.reject(e);
            }
            deferred.resolve(factory);
        }, (e?) => {
            deferred.reject(e)
        });
        return deferred.promise();
    }


    //-------------------------------
    //  Events Handler
    //------------------------------- 
    
    
    /**
     * handle changes in the file system, update / delete / create project accordingly
     */
    private filesChangeHandler = (changeRecords: fs.FileChangeRecord[]) => {
        changeRecords.forEach(record => {
            if (record.kind === fs.FileChangeKind.RESET) {
                //reinitialize the projects if file system reset
                this.disposeProjects();
                this.createProjects();
                return false;
            } else if (tsUtils.isTypeScriptProjectConfigFile(record.path)) {
                this.tempProject.dispose();
                this.tempProject = null;
                switch (record.kind) { 
                    // a config file has been deleted detele the project
                    case fs.FileChangeKind.DELETE:
                        if (this.projectMap.has(record.path)) {
                            this.projectMap.get(record.path).forEach(project => {
                                project.dispose();
                            })
                            this.projectMap.delete(record.path);
                        }
                        break;
                        
                    // a config file has been created or updated update project
                    default:
                        this.creatingProjects = this.creatingProjects.then(() => this.createProjectsFromFile(record.path));
                        break;
                }
            }
            return true;
        }); 
    }
}

export = TypeScriptProjectManager;