// template hpp

template <typename _Hasher>
void
Dedup<_Hasher>::Chunker::push(Buf buf)
{
    // this code is very tight on cpu,
    // se we keep all the stuff that gets accessed on stack,
    // to help it be as cached as possible (registers / L2).

    const Hasher& hasher = _dedup._hasher;
    const int window_len = _dedup._window_len;
    const int min_chunk = _dedup._min_chunk;
    const int max_chunk = _dedup._max_chunk;
    const Hash avg_chunk_mask = _dedup._avg_chunk_mask;
    const Hash avg_chunk_val = _dedup._avg_chunk_val;

    Hash hash = _hash;
    int chunk_len = _chunk_len;
    int window_pos = _window_pos;

    while (buf.length() > 0) {
        const int len = buf.length();
        const uint8_t* data = buf.data();
        const int skip = std::min<int>(min_chunk - chunk_len, len);
        const int end = std::min<int>(max_chunk, chunk_len + len);
        bool boundary = false;

#if 0
        std::cerr << "CHUNK"
                  << " chunk_len " << chunk_len
                  << " len " << len
                  << " skip " << skip
                  << " end " << end
                  << std::endl;
#endif

        // skip byte scanning as long as below min chunk length
        if (skip > 0) {
            chunk_len += skip;
            data += skip;
        }

        while (chunk_len < end) {
            const uint8_t input = *data;
            data++;
            chunk_len++;
            hash = hasher.update(hash, input, _window[window_pos]);
            if ((hash & avg_chunk_mask) == avg_chunk_val) {
                boundary = true;
                break;
            }

            _window[window_pos] = input;
            window_pos++;
            if (window_pos >= window_len) {
                window_pos = 0;
            }
        }

        const int buf_pos = data - buf.data();
        if (buf_pos > 0) {
            _slices.push_back(Buf(buf, 0, buf_pos));
        }
        if (boundary || chunk_len >= max_chunk) {
            // we flush the chunk here, but notice we must synchronize the variables
            // with our contemporary stack variables
            _hash = hash;
            _chunk_len = chunk_len;
            _window_pos = window_pos;
            flush();
            hash = _hash;
            chunk_len = _chunk_len;
            window_pos = _window_pos;
        }
        buf.slice(buf_pos, len - buf_pos);
    }

    // finally sync back changes to variables to their original memory
    _hash = hash;
    _chunk_len = chunk_len;
    _window_pos = window_pos;
}
