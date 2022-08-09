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

#include <iostream>
#include <cstdlib>
#include <unistd.h>
#include <sys/time.h>
#include "example1.h"


Example1Tx::Example1Tx(int samplesPerBlock, int nbOriginalBlocks, int nbFecBlocks)
{
    m_params.BlockBytes = samplesPerBlock * sizeof(Sample);
    m_params.OriginalCount = nbOriginalBlocks;
    m_params.RecoveryCount = nbFecBlocks;
    m_cm256_OK = m_cm256.isInitialized();
}

Example1Tx::~Example1Tx()
{
}

void Example1Tx::makeDataBlocks(SuperBlock *txBlocks, uint16_t frameNumber)
{
    std::srand(frameNumber);

    for (int iblock = 0; iblock < m_params.OriginalCount; iblock++)
    {
        txBlocks[iblock].header.frameIndex = frameNumber;
        txBlocks[iblock].header.blockIndex = (uint8_t) iblock;

        if (iblock == 0) // meta data
        {
        	MetaDataFEC *metaData = (MetaDataFEC *) &txBlocks[iblock].protectedBlock;
        	metaData->init();
        	metaData->m_nbOriginalBlocks = m_params.OriginalCount;
        	metaData->m_nbFECBlocks = m_params.RecoveryCount;
            struct timeval tv;
            gettimeofday(&tv, 0);
            metaData->m_tv_sec = tv.tv_sec;
            metaData->m_tv_usec = tv.tv_usec;
        }
        else
        {
			for (int isample = 0; isample < nbSamplesPerBlock; isample++)
			{
				txBlocks[iblock].protectedBlock.samples[isample].i = std::rand();
				txBlocks[iblock].protectedBlock.samples[isample].q = std::rand();
			}
        }
    }
}

bool Example1Tx::makeFecBlocks(SuperBlock *txBlocks, uint16_t frameIndex)
{
	if (m_params.RecoveryCount > 0)
	{
	    for (int i = 0; i < m_params.OriginalCount; i++)
	    {
	        m_txDescriptorBlocks[i].Block = (void *) &txBlocks[i].protectedBlock;
	        m_txDescriptorBlocks[i].Index = i;
	    }

	    if (m_cm256_OK)
	    {
	        if (m_cm256.cm256_encode(m_params, m_txDescriptorBlocks, m_txRecovery))
	        {
	            std::cerr << "example2: encode failed" << std::endl;
	            return false;
	        }

	        for (int i = 0; i < m_params.RecoveryCount; i++)
	        {
	            txBlocks[i + m_params.OriginalCount].header.blockIndex = i + m_params.OriginalCount;
	            txBlocks[i + m_params.OriginalCount].header.frameIndex = frameIndex;
	            txBlocks[i + m_params.OriginalCount].protectedBlock = m_txRecovery[i];
	        }
	    }
	}

    return true;
}

void Example1Tx::transmitBlocks(SuperBlock *txBlocks,
        const std::string& destaddress,
        int destport,
        std::vector<int>& blockExclusionList,
        int txDelay)
{
    std::vector<int>::iterator exclusionIt = blockExclusionList.begin();

    for (int i = 0; i < m_params.OriginalCount + m_params.RecoveryCount; i++)
    {
        if ((exclusionIt != blockExclusionList.end()) && (*exclusionIt == i))
        {
            ++exclusionIt;
            continue;
        }

        m_socket.SendDataGram((const void *) &txBlocks[i], (int) udpSize, destaddress, destport);
        usleep(txDelay);
    }

    usleep(100*txDelay); // wait at end of frame to let Rx process it
}

Example1Rx::Example1Rx(int samplesPerBlock, int nbOriginalBlocks, int nbFecBlocks) :
    m_frameHead(0),
    m_frameCount(0),
    m_blockCount(0),
    m_metaReceived(false),
    m_dataCount(0),
    m_recoveryCount(0)
{
    m_params.BlockBytes = samplesPerBlock * sizeof(Sample);
    m_params.OriginalCount = nbOriginalBlocks;
    m_params.RecoveryCount = nbFecBlocks;
    m_currentMeta.init();
    m_cm256_OK = m_cm256.isInitialized();
}

Example1Rx::~Example1Rx()
{
}

void Example1Rx::processBlock(SuperBlock& superBlock)
{
    if (superBlock.header.frameIndex != m_frameHead)
    {
        if (m_dataCount != m_params.OriginalCount)
        {
            std::cerr << "Example1Rx::processBlock: incomplete frame" << std::endl;
        }

        m_frameCount++;
        m_blockCount = 0;
        m_metaReceived = false;
        m_dataCount = 0;
        m_recoveryCount = 0;
        m_frameHead = superBlock.header.frameIndex;
    }

    if (m_blockCount < m_params.OriginalCount) // not enough to decode => store data
    {
        int blockIndex = superBlock.header.blockIndex;

        if (blockIndex < m_params.OriginalCount) // data
        {
            m_data[blockIndex] = superBlock.protectedBlock;
            m_descriptorBlocks[m_blockCount].Block = (void *) &m_data[blockIndex];
            m_descriptorBlocks[m_blockCount].Index = blockIndex;
            m_dataCount++;

            if (blockIndex == 0)
            {
                MetaDataFEC *metaData = (MetaDataFEC *) &m_data[blockIndex];

                if (!(*metaData == m_currentMeta))
                {
                    m_currentMeta = *metaData;
                }

                m_metaReceived = true;
            }

//            if (blockIndex == 1)
//            {
//              std::srand(superBlock.header.frameIndex);
//              std::cerr << "Example1Rx::processBlock: " << superBlock.header.frameIndex << ": ";
//
//              for (int k = 0; k < 2; k++)
//              {
//                  uint16_t refI = std::rand();
//                  uint16_t refQ = std::rand();
//
//                  std::cerr  << "[" << k << "] " << m_data[blockIndex].samples[k].i
//                          << "/" << m_data[blockIndex].samples[k].q
//                          << " " << refI
//                          << "/" << refQ
//                          << " ";
//              }
//
//              std::cerr << std::endl;
//            }

        }
        else // recovery data
        {
        	m_recovery[m_recoveryCount] = superBlock.protectedBlock;
            m_descriptorBlocks[m_blockCount].Block = (void *) &m_recovery[m_recoveryCount];
            m_descriptorBlocks[m_blockCount].Index = blockIndex;
            m_recoveryCount++;
        }
    }

    m_blockCount++;

    if (m_blockCount == m_params.OriginalCount) // enough data is received
    {
        if (m_cm256_OK && (m_recoveryCount > 0)) // FEC necessary
        {
            if (m_cm256.cm256_decode(m_params, m_descriptorBlocks)) // failure to decode
            {
                std::cerr << "Example1Rx::processBlock: CM256 decode error" << std::endl;
            }
            else // success to decode
            {
                std::cerr << "Example1Rx::processBlock: CM256 decode success: ";

                int recoveryStart = m_dataCount;

                for (int ir = 0; ir < m_recoveryCount; ir++)
                {
                    int blockIndex = m_descriptorBlocks[recoveryStart + ir].Index;
                    std::cerr << blockIndex << " ";
                    m_data[blockIndex] = *((ProtectedBlock *) m_descriptorBlocks[recoveryStart + ir].Block);
                    m_dataCount++;
                }

                std::cerr << std::endl;
            }
        }

        if (m_dataCount == m_params.OriginalCount)
        {
            checkData();
        }
    }
}

bool Example1Rx::checkData()
{
    bool compOKi = true;
    bool compOKq = true;

    std::srand(m_frameHead);

    for (int i = 1; i < m_params.OriginalCount; i++)
    {
        compOKi = true;
        compOKq = true;

        for (int k = 0; k < nbSamplesPerBlock; k++)
        {
            uint16_t refI = std::rand();
            uint16_t refQ = std::rand();

            if (m_data[i].samples[k].i != refI)
            {
                std::cerr << i << ": error: " << k << ": i: " << m_data[i].samples[k].i << "/" << refI << std::endl;
                compOKi = false;
                break;
            }

            if (m_data[i].samples[k].q != refQ)
            {
                std::cerr << i << ": error: " << k << ": q: " << m_data[i].samples[k].q << "/" << refQ << std::endl;
                compOKq = false;
                break;
            }
        }

        if (compOKi && compOKq)
        {
            std::cerr << ".";
        }
        else
        {
            break;
        }
    }

    if (compOKi && compOKq)
    {
    	std::cerr << "OK" << std::endl;
    	return true;
    }
    else
    {
    	return false;
    }
}

bool example1_tx(const std::string& dataaddress, int dataport, std::vector<int> &blockExclusionList, std::atomic_bool& stopFlag)
{
    SuperBlock txBlocks[256];
    Example1Tx ex1(nbSamplesPerBlock, nbOriginalBlocks, nbRecoveryBlocks);

    std::cerr << "example1_tx: transmitting on address: " << dataaddress << " port: " << dataport << std::endl;

    for (uint16_t frameNumber = 0; !stopFlag.load(); frameNumber++)
    {
        ex1.makeDataBlocks(txBlocks, frameNumber);

        if (!ex1.makeFecBlocks(txBlocks, frameNumber))
        {
            std::cerr << "example1_tx: encode error" << std::endl;
            break;
        }

        ex1.transmitBlocks(txBlocks, dataaddress, dataport, blockExclusionList, 300);

        std::cerr <<  ".";
    }

    return true;
}

bool example1_rx(const std::string& dataaddress, unsigned short dataport, std::atomic_bool& stopFlag)
{
    SuperBlock rxBlock;
    uint8_t rawBlock[sizeof(SuperBlock)];
    uint32_t rawBlockSize;
    UDPSocket rxSocket(dataport);
    std::string senderaddress, senderaddress0;
    unsigned short senderport, senderport0 = 0;
    Example1Rx ex1(nbSamplesPerBlock, nbOriginalBlocks, nbRecoveryBlocks);

    std::cerr << "example1_rx: receiving on address: " << dataaddress << " port: " << (int) dataport << std::endl;

    while (!stopFlag.load())
    {
        rawBlockSize = 0;

        while (rawBlockSize < sizeof(SuperBlock))
        {
            rawBlockSize += rxSocket.RecvDataGram((void *) &rawBlock[rawBlockSize], (int) sizeof(SuperBlock), senderaddress, senderport);

            if ((senderaddress != senderaddress0) || (senderport != senderport0))
            {
            	std::cerr << "example1_rx: connected to: " << senderaddress << ":" << senderport << std::endl;
            	senderaddress0 = senderaddress;
            	senderport0 = senderport;
            }

            usleep(10);
        }

        memcpy(&rxBlock, rawBlock, sizeof(SuperBlock));
        ex1.processBlock(rxBlock);
    }

    return true;
}
