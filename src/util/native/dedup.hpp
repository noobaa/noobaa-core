// template hpp

template <typename _Hasher>
void
Dedup<_Hasher>::Chunker::push(Buf buf)
{
    while (buf.length() > 0) {
        uint8_t* data = buf.data();
        int len = buf.length();
        int pos = 0;
        bool boundary = false;

        // skip hashing as long as below min chunk length
        int remain_to_min = _dedup._min_chunk - _chunk_len;
        if (remain_to_min > 0) {
            int jump = std::min(remain_to_min, buf.length());
            pos += jump;
            _chunk_len += jump;
        }

        while (pos < len) {
            // small manipulation to avoid long sequences of zeros or ones
            // we add more than 1 in order to avoid both 0 and 0xff resulting in 0 .
            uint8_t byte = data[pos]; // TODO do we need to add 2 to the byte?
            _hash = _dedup._hasher.update(_hash, byte, _window[_window_pos]);
            // std::cout << "hash " << std::hex << uint64_t(_hash) << std::endl;
            // std::cout.flush();
            _window[_window_pos] = byte;
            _window_pos = (_window_pos + 1) % _dedup._window_len;
            pos++;
            _chunk_len++;
            if ((_hash & _dedup._avg_chunk_mask) == _dedup._avg_chunk_val
                || _chunk_len >= _dedup._max_chunk) {
                boundary = true;
                break;
            }
        }

        // std::cout << "_slices " << _slices.size() << std::endl;

        _slices.push_back(Buf(buf, 0, pos));
        if (boundary) {
            flush();
        }
        buf.slice(pos, len - pos);
    }
}
