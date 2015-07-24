// template hpp

template <typename _Hasher>
int
Dedup<_Hasher>::Window::push(const uint8_t* data, int len)
{
    // this code is very tight on cpu,
    // se we keep all the stuff that gets accessed on stack,
    // to help it be as cached as possible (registers / L2).
    T hash = _hash;
    int chunk_len = _chunk_len;
    int window_pos = _window_pos;
    const Hasher& hasher = _dedup._hasher;
    const int window_len = _dedup._window_len;
    const int min_chunk = _dedup._min_chunk;
    const int max_chunk = _dedup._max_chunk;
    const T avg_chunk_mask = _dedup._avg_chunk_mask;
    const T avg_chunk_val = _dedup._avg_chunk_val;
    const uint8_t* datap = data;
    const int skip = std::min<int>(min_chunk - chunk_len, len);
    const int end = std::min<int>(max_chunk, chunk_len + len);
    uint8_t byte;
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
        datap += skip;
    }

    // now the heavy part is to scan byte by byte,
    // update the rolling hash by adding the next byte and popping the old byte,
    // and check if the hash marks a chunk boundary.
    while (chunk_len < end) {
        byte = *datap;
        datap++;
        chunk_len++;

        // if (true) { boundary = true; break; }
        hash = hasher.update(hash, byte, _window[window_pos]);
        if ((hash & avg_chunk_mask) == avg_chunk_val) {
            boundary = true;
            break;
        }

        _window[window_pos] = byte;
        window_pos++;
        if (window_pos >= window_len) {
            window_pos = 0;
        }
    }

    // finally sync back changes to changed variables to their original memory
    _hash = hash;
    _chunk_len = chunk_len;
    _window_pos = window_pos;

    if (boundary || chunk_len >= max_chunk) {
        reset();
        return datap - data;
    } else {
        return 0;
    }
}
