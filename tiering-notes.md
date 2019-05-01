# Tiering

### HIGH
- [x] `make_object_id()` separate to `new_object_id()` vs `parse_object_id()`
- [x] upload - test
- [x] read path in object_io and map_client
- [x] copy_object_mapping
- [x] MapClient chunk data cache
- [x] map_reader - implement read_object_mapping vs read_object_mapping_admin
- [x] digest_type and digest_b64 in map_db_types
- [x] UI object-parts-reducer fix to chunks
- [x] UI chunk_info.adminfo - removed...
- [x] map_reader.read_node_mapping
- [x] map_reader should share prepare_chunks_group with map_server
- [x] map_server - allocate_chunk should sort allocations by location_info
- [ ] map_builder - handle objects
- [x] setter for dup_chunk_id 

- [x] object_io - upload_copy should pass the object_md to read_object_stream - where to get it?
- [ ] fix agent_blocks_reclaimer - populate_nodes, delete_blocks, ... (MDStore.instance(...).populate_nodes_for_blocks is not a function)
- [ ] fix agent_blocks_verifier - populate_nodes, delete_blocks, ...

- [x] test_object_io
- [x] test_map_builder
- [ ] test_map*
- [ ] test*


### LOW - without it it would work, but lacking some functionality
- [ ] map_client - infinite loop when no nodes for allocation
- [ ] map_reader - implement update_chunks_on_read with location and move to top tier on read
- [ ] mapper - _block_sorter_basic + _block_sorter_local
- [ ] mapper - should_rebuild_chunk_to_local_mirror


### ADVANCED
- [ ] ts compile error on lint
- [ ] test multiple tiers
- [ ] re-encode chunk when tier coding changes
- [ ] chunk on two tiers for "caching" - implement as single chunk with two frag-sets? or two "linked" chunks? I think the best is to have a second chunk link from the file parts.

### FINISH
- [ ] md_store add @param/@returns jsdocs to verify callers
- [ ] obj.upload_size updates during upload - preserve or remove?
