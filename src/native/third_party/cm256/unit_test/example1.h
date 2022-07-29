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

#ifndef UNIT_TEST_EXAMPLE1_H_
#define UNIT_TEST_EXAMPLE1_H_

#include <string>
#include <atomic>
#include <vector>
#include "data.h"
#include "../cm256.h"
#include "UDPSocket.h"

class Example1Tx
{
public:
    Example1Tx(int samplesPerBlock, int nbOriginalBlocks, int nbFecBlocks);
    ~Example1Tx();

    void makeDataBlocks(SuperBlock *txBlocks, uint16_t frameNumber);
    bool makeFecBlocks(SuperBlock *txBlocks, uint16_t frameInde);
    void transmitBlocks(SuperBlock *txBlocks,
            const std::string& destaddress,
            int destport,
            std::vector<int>& blockExclusionList,
            int txDelay);

protected:
    CM256 m_cm256;
    bool m_cm256_OK;
    CM256::cm256_encoder_params m_params;
    CM256::cm256_block m_txDescriptorBlocks[256];
    ProtectedBlock m_txRecovery[128];
    UDPSocket m_socket;
};

class Example1Rx
{
public:
    Example1Rx(int samplesPerBlock, int nbOriginalBlocks, int nbFecBlocks);
    ~Example1Rx();

    void processBlock(SuperBlock& superBlock);

private:
    bool checkData();

    CM256 m_cm256;
    uint16_t m_frameHead;
    uint64_t m_frameCount;
    int m_blockCount;
    bool m_metaReceived;
    int m_dataCount;
    int m_recoveryCount;
    bool m_cm256_OK;
    MetaDataFEC m_currentMeta;
    CM256::cm256_encoder_params m_params;
    CM256::cm256_block m_descriptorBlocks[256];
    ProtectedBlock m_data[128];
    ProtectedBlock m_recovery[128];
};

bool example1_tx(const std::string& dataaddress, int dataport, std::vector<int> &blockExclusionList, std::atomic_bool& stopFlag);
bool example1_rx(const std::string& dataaddress, unsigned short dataport, std::atomic_bool& stopFlag);

#endif /* UNIT_TEST_EXAMPLE1_H_ */
