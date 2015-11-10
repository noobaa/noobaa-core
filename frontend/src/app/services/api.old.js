
let CLOUD_SYNC_STATES = [ 'NOT_SET', 'UNSYNCED', 'SYNCING', 'PASUED', 'SYNCED', 'UNABLE' ];

class APIClient {
	constructor() {
		this._systemInfo = {
			"buckets": [
				{
					"state": false,
					"name": "my-bucket",
					"storage": {
				        "used": 524288, 
				        "total": 333025640448, 
				        "free": 211049895253.33334 
					},
					"num_objects": 31510,
					"cloud_sync_status": CLOUD_SYNC_STATES[0]
				},
				{
					"state": Math.random() + .5 < 1,
					"name": "another-bucket",
					"storage": {
				        "used": Math.round(Math.random() * 1024**5), 
				        "total": Math.round(Math.random() * 1024**5), 
				        "free": Math.round(Math.random() * 1024**5)
					},
					"num_objects": Math.random() * 100000 | 0,
					//"cloud_sync_status": CLOUD_SYNC_STATES[Math.random() * CLOUD_SYNC_STATES.length | 0],
					"cloud_sync_status": CLOUD_SYNC_STATES[1]
				},				
				{
					"state": Math.random() + .5 < 1,
					"name": "la-bucketa",
					"storage": {
				        "used": Math.round(Math.random() * 1024**5), 
				        "total": Math.round(Math.random() * 1024**5), 
				        "free": Math.round(Math.random() * 1024**5)
					},
					"num_objects": Math.random() * 100000 | 0,
					"cloud_sync_status": CLOUD_SYNC_STATES[2]
				},
				{
					"state": Math.random() + .5 < 1,
					"name": "the-bucket-of-my-life",
					"storage": {
				        "used": Math.round(Math.random() * 1024**5), 
				        "total": Math.round(Math.random() * 1024**5), 
				        "free": Math.round(Math.random() * 1024**5)
					},
					"num_objects": Math.random() * 100000 | 0,
					"cloud_sync_status": CLOUD_SYNC_STATES[3]
				}//,
				// {
				// 	"state": Math.random() + .5 < 1,
				// 	"name": "bucketooooo",
				// 	"storage": {
				//         "used": Math.round(Math.random() * 1024**5), 
				//         "total": Math.round(Math.random() * 1024**5), 
				//         "free": Math.round(Math.random() * 1024**5)
				// 	},
				// 	"num_objects": Math.random() * 100000 | 0,
				// 	"cloud_sync_status": CLOUD_SYNC_STATES[4]
				// }				,
				// {
				// 	"state": Math.random() + .5 < 1,
				// 	"name": "123-bucket",
				// 	"storage": {
				//         "used": Math.round(Math.random() * 1024**5), 
				//         "total": Math.round(Math.random() * 1024**5), 
				//         "free": Math.round(Math.random() * 1024**5)
				// 	},
				// 	"num_objects": Math.random() * 100000 | 0,
				// 	"cloud_sync_status": CLOUD_SYNC_STATES[5]
				// },
				// {
				// 	"state": Math.random() + .5 < 1,
				// 	"name": "the-bucket-of-my-life",
				// 	"storage": {
				//         "used": Math.round(Math.random() * 1024**5), 
				//         "total": Math.round(Math.random() * 1024**5), 
				//         "free": Math.round(Math.random() * 1024**5)
				// 	},
				// 	"num_objects": Math.random() * 100000 | 0,
				// 	"cloud_sync_status": CLOUD_SYNC_STATES[3]
				// },
				// {
				// 	"state": Math.random() + .5 < 1,
				// 	"name": "bucketooooo",
				// 	"storage": {
				//         "used": Math.round(Math.random() * 1024**5), 
				//         "total": Math.round(Math.random() * 1024**5), 
				//         "free": Math.round(Math.random() * 1024**5)
				// 	},
				// 	"num_objects": Math.random() * 100000 | 0,
				// 	"cloud_sync_status": CLOUD_SYNC_STATES[4]
				//}				

			]
		};

		this._nodes = {
			'Nimrods-MacBook-Air.local-fe61d7e7-6b66-4e6c-aa69-ace800fca61f': {
			    node: {
			        id: '563b0bfe063f4eac25170b15',
			        name: 'Nimrods-MacBook-Air.local-fe61d7e7-6b66-4e6c-aa69-ace800fca61f',
			        geolocation: 'Oregon',
			        peer_id: '563b0bfe063f4eac25170b14',
			        ip: '10.128.152.8',
			        rpc_address: 'n2n://563b0bfe063f4eac25170b14',
			        srvmode: undefined,
			        version: '1',
			        tier: 'nodes',
			        heartbeat: 1446710830816,
			        trusted: true,
			        storage: {
			            total: 249769230336,
			            free: 153572446208,
			            used: 6735310,
			            alloc: 0
			        },
			        drives: [{
			                mount: '/',
			                drive_id: '/dev/disk1',
			                storage: {
			                    total: 249769230336,
			                    free: 153572446208,
			                    used: 0
			                }
			            }
			        ],
			        online: true,
			        os_info: {
			            loadavg: [2.630859375, 1.96923828125, 1.82421875],
			            cpus: [{
			                "model": "Intel(R) Core(TM) i7-4650U CPU @ 1.70GHz",
			                "speed": 1700,
			                "times": {
			                    "user": 1458270,
			                    "nice": 0,
			                    "sys": 2247810,
			                    "idle": 11117590,
			                    "irq": 0
			                }
			            }, {
			                "model": "Intel(R) Core(TM) i7-4650U CPU @ 1.70GHz",
			                "speed": 1700,
			                "times": {
			                    "user": 561100,
			                    "nice": 0,
			                    "sys": 551230,
			                    "idle": 13710000,
			                    "irq": 0
			                }
			            }, {
			                "model": "Intel(R) Core(TM) i7-4650U CPU @ 1.70GHz",
			                "speed": 1700,
			                "times": {
			                    "user": 1445010,
			                    "nice": 0,
			                    "sys": 2120880,
			                    "idle": 11256440,
			                    "irq": 0
			                }
			            }, {
			                "model": "Intel(R) Core(TM) i7-4650U CPU @ 1.70GHz",
			                "speed": 1700,
			                "times": {
			                    "user": 591150,
			                    "nice": 0,
			                    "sys": 699910,
			                    "idle": 13531260,
			                    "irq": 0
			                }
			            }],
			            networkInterfaces: {
			                lo0:
			                    [{
			                        address: '::1',
			                        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
			                        family: 'IPv6',
			                        mac: '00:00:00:00:00:00',
			                        scopeid: 0,
			                        internal: true
			                    }, {
			                        address: '127.0.0.1',
			                        netmask: '255.0.0.0',
			                        family: 'IPv4',
			                        mac: '00:00:00:00:00:00',
			                        internal: true
			                    }, {
			                        address: 'fe80::1',
			                        netmask: 'ffff:ffff:ffff:ffff::',
			                        family: 'IPv6',
			                        mac: '00:00:00:00:00:00',
			                        scopeid: 1,

			                        internal: true
			                    }
			                ],

			                en0:
			                    [{
			                        address: 'fe80::9ef3:87ff:febb:7268',
			                        netmask: 'ffff:ffff:ffff:ffff::',
			                        family: 'IPv6',
			                        mac: '9c:f3:87:bb:72:68',
			                        scopeid: 4,
			                        internal: false
			                    },
			                    {
			                        address: '10.128.152.8',
			                        netmask: '255.255.248.0',
			                        family: 'IPv4',
			                        mac: '9c:f3:87:bb:72:68',
			                        internal: false
			                    },
			                ],
			                awdl0:
			                    [{
			                        address: 'fe80::70c9:70ff:fefc:6392',
			                        netmask: 'ffff:ffff:ffff:ffff::',
			                        family: 'IPv6',
			                        mac: '72:c9:70:fc:63:92',
			                        scopeid: 8,
			                        internal: false
			                    }
			                ]
			            },
			            freemem: 906002432,
			            totalmem: 8589934592,
			            uptime: 1446644377152,
			            release: '14.5.0',
			            arch: 'x64',
			            platform: 'darwin',
			            ostype: 'Darwin',
			            hostname: 'Nimrods-MacBook-Air.local'
			        }
			    },

			    objects:
			        [{
			            key: '15MB_1_6710291',
			            bucket: 'files',
			            parts:
			                [{
			                    start: 5653128,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: '669e19BTo6lxYsaWYIR94u6YC6A=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        },
			                    ],
			                    chunk:
			                    {
			                        size: 425987,
			                        digest_type: 'sha384',
			                        digest_b64: '6R6m4he7ez51h2M0R2jZcQLu/lcNbx08APfM82z4JPZjdIVMtBL7DBORWbbtyAXm',
			                        compress_type: 'snappy',
			                        compress_size: 426011,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'VMdSkqBrv76emgGYHBumV4StOzzvIEA+zPW2Bibd7qc=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 6079115,
			                    part_sequence_number: 1
			                },

			                {
			                    start: 6476241,
			                    frags:

			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'W0LZkcPKU36kg3cuQDgDjKtWaR0=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 542431,
			                        digest_type: 'sha384',
			                        digest_b64: 'S8IidGo+3zDEuoieDxEdGpSi4AGFppFb/nMd7x6Yowz94Xj2EKHwCEbcW5F8cajU',
			                        compress_type: 'snappy',
			                        compress_size: 542461,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'sJapzQWOhJoSdyuIoiiRPLTvkLWUTx7fzJw6IztbsG8=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 7018672,
			                    part_sequence_number: 3
			                },

			                {
			                    start: 7018672,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'r2X9ngdyL7PqxFr3SujGL/V7wUA=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],

			                    chunk:

			                    {
			                        size: 411268,
			                        digest_type: 'sha384',
			                        digest_b64: 'tWUbYrFGPt//x+6U/v6Zn/HYhtUBZxE8tSlQZE4WeE1NaXRGbD/0GBqayexIUx2K',
			                        compress_type: 'snappy',
			                        compress_size: 411292,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: '+ZWtuuJi1xPTpmObzwsdeS/L6GYTsRXM2rfXW+p9Tfc=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 7429940,
			                    part_sequence_number: 4
			                },
			                {
			                    start: 7826723,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'cv1p3bbkqOLTQNLuMxX+q0MM01E=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 578215,
			                        digest_type: 'sha384',
			                        digest_b64: 'oYc1ZDKqYOx2ndB3YhdjpJAghZsfARF5EUJwRkJr2WR+AQR8HeLi5klXIk1X85hP',
			                        compress_type: 'snappy',
			                        compress_size: 578245,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'Q23Ug8UPQ63/9fR3l2qaBeJnjjtO/Z5uZYISVF8keEQ=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 8404938,
			                    part_sequence_number: 6
			                },

			                {
			                    start: 8404938,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: '8JWFc9v1fnAivCqwzSTvaoMKZ1s=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 482302,
			                        digest_type: 'sha384',
			                        digest_b64: 'BrMOZpP8NIP2g47e7F/5QW2Ekam5WaezN7QFL4IpYKsZG4a52QR+pPVAiNDWUSy6',
			                        compress_type: 'snappy',
			                        compress_size: 482329,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'r5lxfxz8YqEhiHPU1WDH0wv0yRyHqm/l2hD9nDKcNxE=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 8887240,
			                    part_sequence_number: 7
			                },
			                {
			                    start: 9527496,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'UaHj5lq4bN536bBH+j+nSiXUSg4=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 573562,
			                        digest_type: 'sha384',
			                        digest_b64: 'pwHYFsg/wjCeMUalJDG49eFr3kHpZqQ/uz91qgpX2RmD6QzLZ1aKSbbqPpf9rM+6',
			                        compress_type: 'snappy',
			                        compress_size: 573592,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'i6DZ8w4X0xqYRURswNxWbqZ4tPHM5t45Zxgh5fDaCfU=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 10101058,
			                    part_sequence_number: 9
			                },

			                {
			                    start: 10101058,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: '2q1yMJgbJoiSt1wrHLDCVF+Ykjo=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 384702,
			                        digest_type: 'sha384',
			                        digest_b64: 'pwViBIwyCcuRLXTsppBQLuShDdJO18/IqgSTe9/PGvM6dO7EMw0AyDZ7Lr0B8pTd',
			                        compress_type: 'snappy',
			                        compress_size: 384723,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'O9zyktkyo+S4Ef/BbX5QS4bUSJWgAYwqKQM8jQbLOJs=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 10485760,
			                    part_sequence_number: 10
			                },

			                {
			                    start: 5242880,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'U/odCa27tCsaNYTFtfteyACrZug=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 410248,
			                        digest_type: 'sha384',
			                        digest_b64: 'hoKJy+FVSZuWT3J4BzYbX6hFNSQQM0znAzm7Q51qEYZ1wN1oNcZhF3D2GNjnBZyt',
			                        compress_type: 'snappy',
			                        compress_size: 410272,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: '/AyllRGmDMEdELsdI5/l+h//zl+ionG8e91u6jH8LPQ=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 5653128,
			                    part_sequence_number: 0
			                }
			            ]
			        },

			        {
			            key: '1MB_6710297',
			            bucket: 'files',
			            parts:
			                [{
			                    start: 0,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'PUbPGxXkSQA7uYxCAi4vf9yQJRU=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 436114,
			                        digest_type: 'sha384',
			                        digest_b64: '6Px68tjqdN7Q8pY5htp6TKjNxybhtODP+AJrQ10OU7T7XgHRPlAwOqq4GFRe7tCe',
			                        compress_type: 'snappy',
			                        compress_size: 436138,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'G68QsSh53yjVxYZs3P5ZL9aTDXPrL4+0YDv4gBlxRhI=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 436114,
			                    part_sequence_number: 0
			                },
			                {
			                    start: 436114,
			                    frags:
			                        [{
			                            layer: 'D',
			                            frag: 0,
			                            digest_type: 'sha1',
			                            digest_b64: 'mxnTMnc/7Ylz6PBfjcKQ63R29JA=',
			                            adminfo: {
			                                health: 'healthy'
			                            },
			                            blocks: [
			                            ]
			                        }
			                    ],
			                    chunk:
			                    {
			                        size: 612462,
			                        digest_type: 'sha384',
			                        digest_b64: 'priPIrFNjtjH5tKagQqlxO5hiUlqOuK4aqb4aIs8tlWSMAMLA66gOIp7KTMl4+pr',
			                        compress_type: 'snappy',
			                        compress_size: 612495,
			                        cipher_type: 'aes-256-gcm',
			                        cipher_key_b64: 'wMHjWYZ9xy6bvt0pfFmz9YJ/3kXU89JI5GTmNvhvtBA=',
			                        cipher_iv_b64: undefined,
			                        cipher_auth_tag_b64: undefined,
			                        data_frags: 1,
			                        lrc_frags: 0,
			                        adminfo: {
			                            health: 'available'
			                        }
			                    },
			                    end: 1048576,
			                    part_sequence_number: 1
			                }
			            ]
			        }
			    ]
			}
		};
	}

	read_system() {
		console.log('API: Reading System Infromation');
		
		return Promise.resolve(this._systemInfo)
	}

	create_bucket({ name }) {
		console.log(`API: creating bucket "${name}"`);
		this._systemInfo.buckets
			.push({
				"state": true,
				"name": name,
				"storage": {
			        "used": 0,
			        "total": 0,
			        "free": 0
				},
				"num_objects": 0,
				"cloud_sync_status": 'NOT_SET'
			});

		return Promise.resolve();
	}

	delete_bucket({ name }) {
		console.log(`API: deleteing bucket "${name}"`);
		
		let buckets = this._systemInfo.buckets;
		let i = buckets.findIndex(bucket => bucket.name === name);

		if (i != -1) {
			buckets.splice(i, 1);
		}

		return Promise.resolve();
	}

	read_node({ name }) {
		if (!this._nodes.hasOwnProperty(name)) {
			return Promise.reject({ 
				message: 'node not found' 
			});
		}

		return Promise.resolve(
			this._nodes[name].node
		);
	}

	read_node_maps({ name, skip = 0, limit = 10 }) {
		if (!this._nodes.hasOwnProperty(name)) {
			return Promise.reject({ 
				message: 'node not found' 
			});
		}		

		return Promise.resolve(
			this._nodes[name].objects
		);
	}
}

export default new APIClient();