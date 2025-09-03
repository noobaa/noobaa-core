#include "common.h"

namespace noobaa
{
bool LOG_TO_STDERR_ENABLED = true;
bool LOG_TO_SYSLOG_ENABLED = false;
std::string SYSLOG_DEBUG_FACILITY = "LOG_LOCAL0";

int 
_convert_facility(const std::string& facility_str)
{
    int facility = LOG_LOCAL0; 
    if (facility_str == "LOG_LOCAL0") {
        facility = LOG_LOCAL0;
    } else if (facility_str == "LOG_LOCAL1") {
        facility = LOG_LOCAL1;
    } else if (facility_str == "LOG_LOCAL2") {
        facility = LOG_LOCAL2;
    } else {
        throw Exception("Syslog facility not supported");
    }
    return facility;
}
}
