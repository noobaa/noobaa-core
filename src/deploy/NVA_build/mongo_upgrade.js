/* global db */
'use strict';

/* Upade mongo structures and values with new things since the latest version*/


db.systems.find().forEach(function(sys) {
    if (!sys.resources.linux_agent_installer) {
        db.systems.update({
            _id: sys._id
        }, {
            $set: {
                resources: {
                    linux_agent_installer: 'noobaa-setup',
                    agent_installer: 'noobaa-setup.exe',
                    s3rest_installer: 'noobaa-s3rest.exe'
                }
            }
        });
    }
});
