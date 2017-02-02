/* Copyright (C) 2016 NooBaa */
#include "signup_validator.h"
#include <fstream>
#include <sstream>
#include <string>

#ifdef WIN32
# define popen _popen
# define pclose _pclose
#endif

namespace noobaa {


Nan::Persistent<v8::Function> SignupValidator::_ctor;

NAN_MODULE_INIT(SignupValidator::setup) {
    auto name = "SignupValidator";
    auto tpl = Nan::New<v8::FunctionTemplate>(SignupValidator::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "validate", SignupValidator::validate);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(SignupValidator::new_instance) {
    NAN_MAKE_CTOR_CALL(_ctor);
    SignupValidator *obj = new SignupValidator();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

NAN_METHOD(SignupValidator::validate) {
    Nan::Utf8String email_code_json(info[0]);
    FILE *in;
    char buff[512];
    //TODO: set the url dynamically according to phone home server address
    std::string command =
        "curl -s -X POST"
        " -d \'" + std::string(*email_code_json) + "\'"
        " --header \"Content-Type:application/json\""
        " https://phonehome.noobaa.com/validate_creation";
    if (!(in = popen(command.c_str(), "r"))) {
        return;
    }
    std::stringstream stream;
    while (fgets(buff, sizeof(buff), in) != NULL) {
        stream << buff;
    }
    pclose(in);
    std::string result = stream.str();
    if (result == "ok") {
        std::string path;
        if (const char *core_dir = std::getenv("CORE_DIR")) {
            path = std::string(core_dir) + "/noobaa.stat";
        } else {
            const char* home_dir = std::getenv("HOME");
            path = std::string(home_dir) + "/noobaa.stat";
        }
        std::ofstream outfile;
        outfile.open(path.c_str());
        outfile.write(" ", 1);
        outfile.close();
        return;
    }
}

SignupValidator::SignupValidator() { LOG("SignupValidator created"); }

SignupValidator::~SignupValidator() {}

} // namespace noobaa
