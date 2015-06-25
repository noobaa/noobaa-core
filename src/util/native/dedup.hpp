// template hpp

template<typename Hasher_>
void
Dedup<Hasher_>::push(Buf buf)
{
    uint8_t* data = buf.udata();
    int len = buf.length();
    // int begin = 0;
    _bufs.push_back(buf);

    for (int i=0; i<len; i++) {

        // skip hashing as long as below min chunk length
        if (_current_len < _conf.min_chunk) {
            int skip = std::min(_conf.min_chunk - _current_len, len - i);
            _current_len += skip;
            i += skip - 1;
            continue;
        }

        _current_len++;
        HashType hash = _hasher.update(data[i]);

        if ((hash & _conf.avg_chunk_mask) == _conf.avg_chunk_val) {
            _hasher.reset();

            Buf chunk(_current_len);
            int pos = 0;
            while (!_bufs.empty()) {
                Buf it(_bufs.front());
                _bufs.pop_front();
                memcpy(chunk.data() + pos, it.data(), it.length());
            }
        }
    }

}
