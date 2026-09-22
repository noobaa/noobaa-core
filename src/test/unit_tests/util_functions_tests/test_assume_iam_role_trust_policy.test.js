/* Copyright (C) 2026 NooBaa */
/*eslint max-lines-per-function: ["error", 1300]*/
'use strict';

// Mock jwks-rsa to fix the  problem is that jwks-rsa depends on jose which uses ES modules, 
// but Jest is running in CommonJS mode.
jest.mock('jwks-rsa', () => jest.fn().mockImplementation(() => ({
    getSigningKey: jest.fn((kid, cb) => cb(null, {
        getPublicKey: () => '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    })),
})));

const access_policy_utils = require('../../../util/access_policy_utils');


describe('IAM Policy Utils - Trust Policy Condition Validation', () => {

    describe('StringEquals Operator', () => {


        it('should validate single StringEquals condition - match', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws.amazon.com/tags": {
                    principal_tags: {
                        Department: "Engineering",
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate single StringEquals condition - no match', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Sales'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should validate multiple StringEquals conditions - all match', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                Team: 'DevOps',
                                Environment: 'Production'
                            }
                        }
                    }
                },
            };

            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering',
                    'aws:RequestTag/Team': 'DevOps',
                    'aws:RequestTag/Environment': 'Production'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate multiple StringEquals conditions - partial match fails', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                Team: 'QA'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering',
                    'aws:RequestTag/Team': 'DevOps'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should handle StringEquals with array values in condition', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': ['Engineering', 'DevOps']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should handle StringEquals with array values in tags_claim', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: ['Engineering', 'Research']
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });
    });

    describe('ForAnyValue:StringEquals Operator', () => {

        it('should validate ForAnyValue:StringEquals - single match', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Team: ['Engineering', 'QA']
                            }
                        }
                    }
                },
            };
            const conditions = {
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Engineering']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate ForAnyValue:StringEquals - no match', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Team: ['QA', 'Support']
                            }
                        }
                    }
                },
            };

            const conditions = {
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Engineering']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should validate ForAnyValue:StringEquals with single value in claim', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Team: 'Engineering'
                            }
                        }
                    }
                },
            };

            const conditions = {
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Engineering', 'QA']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate multiple ForAnyValue:StringEquals conditions', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Team: ['Engineering', 'QA'],
                                Project: ['ProjectA', 'ProjectB']
                            }
                        }
                    }
                },
            };

            const conditions = {
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['Engineering', 'DevOps'],
                    'aws:RequestTag/Project': ['ProjectA', 'ProjectC']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate ForAnyValue:StringEquals with all matching values', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Roles: ['Admin', 'Developer', 'Tester']
                            }
                        }
                    }
                },
            };

            const conditions = {
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Roles': ['Admin', 'Developer']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });
    });


    describe('Mixed Operators', () => {

        it('should validate mixed StringEquals and ForAnyValue:StringEquals', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                Team: ['DevOps', 'QA']
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                },
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Security']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should fail if any operator condition fails', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                Team: ['QA', 'Support']
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                },
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Security']
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should validate complex mixed conditions', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                Team: ['DevOps', 'Security'],
                                Email: 'user@noobaa.io',
                                CostCenter: 'CC-123'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering',
                    'aws:RequestTag/CostCenter': 'CC-123'
                },
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'Engineering']
                },
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });
    });

    describe('condition validation invalide Cases', () => {

        it('should return true when no conditions provided', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = {};
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should return true when conditions is undefined', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = undefined;
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should return false when tags_claim is null but conditions exist', () => {
            const web_identity_info = null;
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should return false when tags_claim is undefined but conditions exist', () => {
            const web_identity_info = undefined;
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should handle custom condition key formats', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:request_tag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should handle missing tag in claim', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                               Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Team': 'DevOps'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should handle empty string values', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                               Department: ''
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Department': ''
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should handle numeric values as strings', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                               CostCenter: 123
                            }
                        }
                    }
                },
            };
            const conditions = {
                StringEquals: {
                    'aws:RequestTag/CostCenter': '123'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should return false for unsupported operators', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                               Department: 'Engineering'
                            }
                        }
                    }
                },
            };
            const conditions = {
                UnsupportedOperator: {
                    'aws:RequestTag/Department': 'Engineering'
                }
            };
            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });
    });

    describe('Condition Key Extraction', () => {
        it('should extract tag key from aws:RequestTag/ format', () => {
            const key = access_policy_utils.extract_tag_key_from_condition('aws:RequestTag/Department');
            expect(key).toBe('Department');
        });

        it('should extract tag key from token:principal_tags/ format', () => {
            const key = access_policy_utils.extract_tag_key_from_condition('token:principal_tags/Team');
            expect(key).toBe('Team');
        });

        it('should extract tag key from path with multiple slashes', () => {
            const key = access_policy_utils.extract_tag_key_from_condition('custom/path/TagName');
            expect(key).toBe('TagName');
        });

        it('should return key as-is when no special format', () => {
            const key = access_policy_utils.extract_tag_key_from_condition('SimpleKey');
            expect(key).toBe('SimpleKey');
        });
    });

    describe('Real-world IAM Trust Policy Examples', () => {

        it('should validate complete trust policy with conditions', () => {
            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                CostCenter: 'CC-123',
                                Project: 'NooBaa'
                            }
                        }
                    }
                },
            };

            const trust_policy_statement = {
                Effect: 'Allow',
                Principal: {
                    Federated: 'arn:aws:iam::123456789012:oidc-provider/keycloak.example.com'
                },
                Action: 'sts:AssumeRoleWithWebIdentity',
                Condition: {
                    StringEquals: {
                        'aws:RequestTag/Department': 'Engineering',
                        'aws:RequestTag/CostCenter': 'CC-123'
                    },
                    'ForAnyValue:StringEquals': {
                        'aws:RequestTag/Project': ['NooBaa', 'S3Compatible']
                    }
                }
            };

            const result = access_policy_utils._is_identity_condition_fit(true, trust_policy_statement.Condition, web_identity_info);
            expect(result).toBe(true);
        });

        it('should deny access when production conditions not met', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Environment: 'Development',
                                Team: ['QA'],
                                Email: 'dev@company.com',
                                Clearance: 'Low'
                            }
                        }
                    }
                },
            };

            const conditions = {
                StringEquals: {
                    'aws:RequestTag/Environment': 'Production',
                    'aws:RequestTag/Clearance': 'High'
                },
                'ForAnyValue:StringEquals': {
                    'aws:RequestTag/Team': ['DevOps', 'SRE', 'Security']
                }
            };

            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });

        it('should validate provider aud with request tags from separate token claims', () => {

            const web_identity_info = {
                iss: "http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa",
                aud: ['CLIENT_ID', 'account'],
                typ: 'Bearer',
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering',
                                CostCenter: 'CC-123'
                            }
                        }
                    }
                },
            };

            const conditions = {
                StringEquals: {
                    'keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:aud': 'CLIENT_ID',
                    'aws:RequestTag/Department': 'Engineering',
                    'aws:RequestTag/CostCenter': 'CC-123'
                }
            };

            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should validate provider sub and azp from token claims', () => {

            const web_identity_info = {
                sub: '1e59d996-2aa9-4a91-9740-d9cf61ccfd3e',
                azp: 'noobaa-client',
                iss: 'http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa',
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };

            const conditions = {
                StringEquals: {
                    'keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:sub': '1e59d996-2aa9-4a91-9740-d9cf61ccfd3e',
                    'keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:azp': 'noobaa-client',
                    'aws:RequestTag/Department': 'Engineering'
                }
            };

            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(true);
        });

        it('should deny access when provider aud does not match token claims', () => {

            const web_identity_info = {
                aud: ['other-client', 'account'],
                iss: 'http://keycloak.noobaa.svc.cluster.local:8080/realms/noobaa',
                "https://aws": {
                    amazon: {
                        "com/tags": {
                            principal_tags: {
                                Department: 'Engineering'
                            }
                        }
                    }
                },
            };


            const conditions = {
                StringEquals: {
                    'keycloak.noobaa.svc.cluster.local:8080/realms/noobaa:aud': 'CLIENT_ID',
                    'aws:RequestTag/Department': 'Engineering'
                }
            };

            const result = access_policy_utils._is_identity_condition_fit(true, conditions, web_identity_info);
            expect(result).toBe(false);
        });
    });
});
