/*
    Copyright (c) 2016 Edouard M. Griffiths.  All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of CM256 nor the names of its contributors may be
      used to endorse or promote products derived from this software without
      specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGE.
*/

#include <climits>
#include <sys/time.h>
#include <iostream>
#include <regex>

#include "mainutils.h"

long long getUSecs()
{
    struct timeval tp;
    gettimeofday(&tp, 0);
    return (long long) tp.tv_sec * 1000000L + tp.tv_usec;
}

bool parse_int(const char *s, int& v, bool allow_unit)
{
    char *endp;
    long t = strtol(s, &endp, 10);
    if (endp == s)
        return false;
    if ( allow_unit && *endp == 'k' &&
         t > INT_MIN / 1000 && t < INT_MAX / 1000 ) {
        t *= 1000;
        endp++;
    }
    if (*endp != '\0' || t < INT_MIN || t > INT_MAX)
        return false;
    v = t;
    return true;
}

void badarg(const char *label)
{
    fprintf(stderr, "ERROR: Invalid argument for %s\n", label);
}

bool getIntList(std::vector<int>& listInt, std::string& listString)
{
  bool converted_successfully   = true;
  std::regex splitter(",");
  auto list_begin               = std::sregex_iterator(listString.begin(),
                                                       listString.end(),
                                                       splitter);
  auto list_end                 = std::sregex_iterator();

  try {
      for (std::sregex_iterator i = list_begin; i != list_end; ++i) {
        listInt.push_back(std::stoi(i->str()));
      }
  } catch (std::invalid_argument & exception) {
    converted_successfully      = false;
    fprintf(stderr, "ERROR: Invalid element: %s\n", listString.c_str());
  } catch(std::out_of_range & exception) {
    converted_successfully      = false;
    fprintf(stderr, "ERROR: Element out of range: %s\n", listString.c_str());
  }

  return converted_successfully;
}
