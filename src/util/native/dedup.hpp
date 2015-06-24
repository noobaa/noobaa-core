// template hpp

template<typename Hasher_>
void
Dedup<Hasher_>::push(const uint8_t* data, int len)
{
    // int begin = 0;

    for (int i=0; i<len; i++) {

        // skip hashing as long as below min chunk length
        if (_current_len < _conf.min_chunk) {
            int skip = std::min(_conf.min_chunk - _current_len, len - i);
            _current_len += skip;
            i += skip - 1;
            continue;
        }

        HashType hash = _hasher.update(data[i]);
        _current_len++;

        if ((hash & _conf.avg_chunk_mask) == _conf.avg_chunk_val) {

        }
    }
}
