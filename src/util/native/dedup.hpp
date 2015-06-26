// template hpp

template<typename Hasher_>
void
Dedup<Hasher_>::push(Buf buf)
{
    while (buf.length() > 0) {
        uint8_t* data = buf.data();
        int len = buf.length();
        int pos = 0;
        bool boundary = false;

        // skip hashing as long as below min chunk length
        int remain_to_min = _conf.min_chunk - _current_len;
        if (remain_to_min > 0) {
            int jump = std::min(remain_to_min, buf.length());
            pos += jump;
            _current_len += jump;
        }

        while (pos < len) {
            HashType hash = _hasher.update(data[pos]);
            pos++;
            _current_len++;
            if ((hash & _conf.avg_chunk_mask) == _conf.avg_chunk_val
                || _current_len >= _conf.max_chunk) {
                boundary = true;
                break;
            }
        }

        _slices.push_back(Buf(buf, 0, pos));
        if (boundary) {
            flush();
        }
        buf.slice(pos, len - pos);
    }
}

template<typename Hasher_>
void
Dedup<Hasher_>::flush()
{
    std::cout << "Boundary hash " << std::hex << _hasher.value() << std::endl;
    _chunks.push_back(Buf::concat(_slices.begin(), _slices.end(), _current_len));
    _slices.clear();
    _hasher.reset();
    _current_len = 0;
}
