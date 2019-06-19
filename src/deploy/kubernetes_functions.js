/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const request = require('request');
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');




const IS_IN_POD = process.env.CONTAINER_PLATFORM === 'KUBERNETES';

class KubernetesFunctions {

    constructor({
        context,
        output_dir = "./",
        node_ip,
        namespace
    }) {
        this.context = context;
        this.output_dir = output_dir;
        this.node_ip = node_ip;
        if (namespace) {
            this._create_namespace = true;
            this.namespace = namespace;
        }
    }


    async init() {
        if (!this.namespace) {
            if (IS_IN_POD) {
                this.namespace = (await fs.readFileAsync('/var/run/secrets/kubernetes.io/serviceaccount/namespace')).toString();
            } else {
                this.namespace = await this.kubectl(`config view --minify --output 'jsonpath={..namespace}'`, { ignore_namespace: true });
            }
        }
        if (this._create_namespace) {
            await this.create_namespace();
        }
    }

    async kubectl(command, options = {}) {
        const {
            ignore_namespace
        } = options;
        try {
            const context = this.context ? `--context ${this.context}` : '';
            const namespace = ignore_namespace || !this.namespace ? '' : `-n ${this.namespace}`;
            const command_to_exec = `kubectl ${context} ${namespace} ${command}`;
            return promise_utils.exec(command_to_exec, { return_stdout: true, trim_stdout: true });
        } catch (err) {
            throw new Error(`kubectl error: failed to run command '${command}'. error:` + err.message);
        }
    }

    async create_namespace() {
        await this.kubectl(`create namespace ${this.namespace}`, { ignore_namespace: true });
    }

    async delete_namespace() {
        await this.kubectl(`delete namespace ${this.namespace}`, { ignore_namespace: true });
    }

    /**  
     * returns an array of all resources in a yaml\json\url
     */
    async read_resources(file_path) {
        try {
            const file_json = await this.kubectl(`apply -f ${file_path} --dry-run -o json`);
            const resources = JSON.parse(file_json);
            return resources.items;
        } catch (err) {
            console.error(`failed to load noobaa resources from ${file_path}. error:`, err);
            throw err;
        }
    }

    /**  
     * get an object where the keys are the resource name and the value is the resource as js object. write to yaml file 
     */
    async write_resources(file, resources) {
        const file_content = _.map(resources, resource => JSON.stringify(resource)).join('\n');
        await fs.writeFileAsync(file, file_content);
    }



    async kubectl_get(resource, name) {
        const stdout = await this.kubectl(`get ${resource} ${name} -o json`);
        try {
            return JSON.parse(stdout);
        } catch (err) {
            throw new Error('failed to parse kubectl output:' + stdout);
        }
    }

    update_statefulset({ statefulset, replicas, image, envs, cpu, mem, pv, pull_always }) {
        if (image) {
            // modify image of the statefulset
            statefulset.spec.template.spec.containers[0].image = image;
        }

        if (pull_always) {
            // change pull policy to always
            statefulset.spec.template.spec.containers[0].imagePullPolicy = 'Always';
        }

        if (cpu) {
            statefulset.spec.template.spec.containers[0].resources.requests.cpu = cpu;
        }

        if (mem) {
            statefulset.spec.template.spec.containers[0].resources.requests.memory = mem;
        }

        // set env 
        if (envs) {
            statefulset.spec.template.spec.containers[0].env = (statefulset.spec.template.spec.containers[0].env || []).concat(envs);
        }

        if (replicas) {
            statefulset.spec.replicas = replicas;
        }

        if (!pv) {
            //remove persistent volume claim and mounts from the statefulset
            statefulset.spec.template.spec.containers[0].volumeMounts = null;
            statefulset.spec.volumeClaimTemplates = null;

        }
    }


    /**
     * if running inside a pod there is no need for LB service (external ip)
     * avoid allocating external ips to save quotas
     */
    convert_lb_to_node_port(services) {
        if (IS_IN_POD) {
            for (const srv of services) {
                if (srv.spec.type === 'LoadBalancer') {
                    srv.spec.type = 'NodePort';
                }
            }
        }
    }


    async deploy_server({ image, server_yaml, envs, cpu, mem, pv, pull_always }) {
        const server_details = {};
        try {
            let resources_file_path = path.join(this.output_dir, `${this.namespace}.server_deployment.${Date.now()}.json`);
            // modify resources and write to temp yaml
            const resources = await this.read_resources(server_yaml);
            const statefulset = resources.find(res => res.kind === 'StatefulSet');
            const pod_name = `${statefulset.metadata.name}-0`;
            this.update_statefulset({ statefulset, image, envs, cpu, mem, pv, pull_always });
            this.convert_lb_to_node_port(resources.filter(res => res.kind === 'Service'));
            await this.write_resources(resources_file_path, resources);

            console.log('deploying server resources from file', resources_file_path);
            await this.kubectl(`apply -f ${resources_file_path}`);

            // get services info
            console.log('getting s3 and managements services address');
            const { address: s3_addr, ports: s3_ports } = await this.get_service_address('s3');
            const { address: mgmt_addr, ports: mgmt_ports } = await this.get_service_address('noobaa-mgmt', 'mgmt-https');
            server_details.services = {
                namespace: this.namespace,
                s3: { address: s3_addr, ports: s3_ports },
                mgmt: { address: mgmt_addr, ports: mgmt_ports },
            };
            server_details.pod_name = pod_name;

            // wait for server pod to be ready
            await this.wait_for_pod_ready(pod_name, () => this.test_http_req(`http://${mgmt_addr}:${mgmt_ports.mgmt}/version`, 200));

            this.server_details = server_details;
            return server_details;
        } catch (err) {
            console.error('failed to deploy server. error:', err);
            throw err;
        }
    }


    async deploy_agents({ image, num_agents, agents_yaml, envs, cpu, mem, pv, pull_always }) {
        if (!num_agents) {
            return;
        }
        try {
            let resources_file_path = path.join(this.output_dir, `${this.namespace}.agents_deployment.${Date.now()}.json`);
            // modify resources and write to temp yaml
            const resources = await this.read_resources(agents_yaml);
            const statefulset = resources.find(res => res.kind === 'StatefulSet');
            const statefulset_name = statefulset.metadata.name;
            this.update_statefulset({ statefulset, image, replicas: num_agents, cpu, mem, envs, pv, pull_always });
            this.convert_lb_to_node_port(resources.filter(res => res.kind === 'Service'));
            await this.write_resources(resources_file_path, resources);

            console.log('deploying agents resources from file', resources_file_path);
            await this.kubectl(`apply -f ${resources_file_path}`);

            // wait for all agents to be ready:
            await P.all(_.times(num_agents).map(i => this.wait_for_pod_ready(`${statefulset_name}-${i}`)));


        } catch (err) {
            console.error('failed to deploy server. error:', err);
            throw err;
        }
    }


    /**
     * get external ip\dns name for a specific service.
     * may take some time. default timeout is 20 minutes
     */
    async get_service_address(service_name, options = {}) {
        const { timeout = 10 * 60000 } = options;
        let service = await this.kubectl_get('service', service_name);
        const ports = _.mapValues(_.keyBy(service.spec.ports, 'name'), p => p.port);
        if (IS_IN_POD) {
            const address = service.spec.clusterIP;
            return { address, ports };
        } else if (this.node_ip) {
            return { address: this.node_ip, port: ports };
        } else {
            console.log('waiting for exeternal ips to be allocated. may take some time..');
            // 20 minutes timeout by default
            return P.resolve()
                .then(async () => {
                    const delay = 10000;
                    let address = null;
                    // get external ip
                    while (!address) {
                        service = await this.kubectl_get('service', service_name);
                        const ingress = _.get(service, 'status.loadBalancer.ingress.0.ip');
                        const hostname = _.get(service, 'status.loadBalancer.ingress.0.hostname');
                        const external_ip = _.get(service, 'spec.externalIPs.0');
                        address = ingress || hostname || external_ip;
                        if (!address) {
                            await P.delay(delay);
                        }
                    }
                    return { address, ports };
                })
                .timeout(timeout);
        }
    }




    async wait_for_pod_ready(pod_name, additional_test, options = {}) {
        const delay = 10000;
        console.log(`waiting for pod ${pod_name} to become ready..`);
        // 20 minutes timeout by default
        const { timeout = 10 * 60000 } = options;
        return P.resolve()
            .then(async () => {
                let ready = false;
                while (!ready) {
                    try {
                        const pod = await this.kubectl_get('pod', pod_name);
                        ready = (pod.status.containerStatuses[0].ready);
                        if (additional_test) {
                            ready = ready && additional_test();
                        }
                        if (!ready) {
                            throw new Error('not ready');
                        }
                    } catch (err) {
                        await P.delay(delay);
                    }
                }
                console.log(`pod ${pod_name} is ready`);
            })
            .timeout(timeout);
    }

    async test_http_req(test_url, expected_status, timeout) {
        try {
            const req_options = {
                url: test_url,
                timeout: timeout || 10000,
                rejectUnauthorized: false,
            };
            const res = await P.fromCallback(callback => request(req_options, callback));
            if (res.statusCode !== expected_status) {
                return false;
            }
            return true;
        } catch (err) {
            return false;
        }
    }

}

exports.KubernetesFunctions = KubernetesFunctions;
exports.IS_IN_POD = IS_IN_POD;
