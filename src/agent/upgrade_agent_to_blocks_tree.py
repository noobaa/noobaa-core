# This script helps to upgrade agent blocks structure to new tree blocks
# The reason it's written in python is that node.js does not allow to
# readdir iteratively and fails on OutOfMemory.
# See pending issues:
# https://github.com/libuv/libuv/pull/416
# https://github.com/nodejs/node/issues/583

import os, sys

wet = False
verbose = False
path = '/usr/local/noobaa/agent_storage/'
for arg in sys.argv[1:]:
    if arg == '--wet':
        wet = True
    elif arg in ('--verbose', '-v'):
        verbose = True
    elif os.path.isdir(arg):
        path = arg

for node in os.listdir(path):

    blocks_path = path + node + '/blocks/'
    if not os.path.isdir(blocks_path):
        print '*** Skipping non dir:', blocks_path
        break

    blocks_tree_path = path + node + '/blocks_tree/'
    if not os.path.isdir(blocks_tree_path):
        if wet: os.mkdir(blocks_tree_path)

    print 'Creating tree dirs under:', blocks_tree_path
    for i in xrange(0, 0x1000):
        tree_path = blocks_tree_path + ('%03x' % i) + '.blocks'
        if os.path.isdir(tree_path): continue
        print 'Creating tree dir:', tree_path
        if wet: os.mkdir(tree_path)

    print 'Moving blocks to:', blocks_tree_path
    count = 0
    for f in os.listdir(blocks_path):
        sp = f.split('.')
        if sp[1] != 'data' and sp[1] != 'meta':
            print '*** Skipping non data/meta block extension:', f
            continue
        tree_path = None
        try:
            i = int(sp[0], 16) % 0x1000
            tree_path = blocks_tree_path + ('%03x' % i) + '.blocks/'
        except ValueError:
            tree_path = blocks_tree_path + 'other.blocks/'
            continue
        if verbose: print 'Moving block:', f, '->', tree_path
        if wet: os.rename(blocks_path + f, tree_path + f)
        count += 1
        if count % 1000 == 0: print 'Count:', count

    print 'Finished. now remove blocks dir', blocks_path
    if wet: os.rmdir(blocks_path)
