NAME="test_lambda"
ENDPOINT="http://127.0.0.1:6002"

echo "-----> Preparing ..."
rm ${NAME}_out
rm ${NAME}.zip
rm ${NAME}.js
cat >${NAME}.js <<EOF
exports.handler = function(event, context, callback) {
    callback(null, '\n This Lambda was run on NooBaa !!!\n\n');
};
EOF
zip ${NAME}.zip ${NAME}.js

echo
echo "-----> create-function ..."
aws lambda create-function \
    --function-name ${NAME} \
    --runtime nodejs4.3 \
    --handler ${NAME}.handler \
    --role arn:aws:iam::638243541865:role/lambda-test \
    --zip-file fileb://${NAME}.zip \
    --endpoint-url ${ENDPOINT}

echo
echo "-----> list-functions ..."
aws lambda list-functions \
    --endpoint-url ${ENDPOINT}

echo
echo "-----> invoke ..."
aws lambda invoke \
    --function-name ${NAME} ${NAME}_out \
    --endpoint-url ${ENDPOINT}

echo
echo "-----> print ..."
cat ${NAME}_out
