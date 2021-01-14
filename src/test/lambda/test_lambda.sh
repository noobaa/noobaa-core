NAME="test_lambda"
ENDPOINT="http://localhost:6001"
PROFILE="noobaa"
AWS="aws --endpoint-url ${ENDPOINT} --profile ${PROFILE} --debug"

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
${AWS} lambda create-function \
    --function-name ${NAME} \
    --runtime nodejs4.3 \
    --handler ${NAME}.handler \
    --role arn:aws:iam::112233445566:role/lambda-test \
    --zip-file fileb://${NAME}.zip

echo
echo "-----> list-functions ..."
${AWS} lambda list-functions

echo
echo "-----> invoke ..."
${AWS} lambda invoke \
    --function-name ${NAME} ${NAME}_out

echo
echo "-----> print ..."
cat ${NAME}_out
