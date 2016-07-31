# This script helps to upgrade agent blocks structure to new tree blocks
# The reason it's written in python is that node.js does not allow to
# readdir iteratively and fails on OutOfMemory.
# See pending issues:
# https://github.com/libuv/libuv/pull/416
# https://github.com/nodejs/node/issues/583

import os, sys

wet = False
verbose = False

def upgrade_agent_storage(agent_storage):
    if not os.path.isdir(agent_storage):
        print '*** No agent_storage dir in:', agent_storage
        return

    for node in os.listdir(agent_storage):

        blocks_path = os.path.join(agent_storage, node, 'blocks')
        if not os.path.isdir(blocks_path):
            print '*** No blocks dir found in:', blocks_path
            continue

        blocks_tree_path = os.path.join(agent_storage, node, 'blocks_tree')
        print 'Creating tree dirs under:', blocks_tree_path
        if not os.path.isdir(blocks_tree_path):
            if wet: os.mkdir(blocks_tree_path)
        blocks_tree_other_path = os.path.join(blocks_tree_path, 'other.blocks')
        if not os.path.isdir(blocks_tree_other_path):
            if wet: os.mkdir(blocks_tree_other_path)
        for i in xrange(0, 0x1000):
            tree_path = os.path.join(blocks_tree_path, ('%03x' % i) + '.blocks')
            if not os.path.isdir(tree_path):
                if wet: os.mkdir(tree_path)

        print 'Moving blocks to:', blocks_tree_path
        count = 0
        for f in os.listdir(blocks_path):
            sp = f.split('.')
            tree_path = blocks_tree_other_path
            try:
                if len(sp) == 2 and (sp[1] == 'data' or sp[1] == 'meta'):
                    i = int(sp[0], 16) % 0x1000
                    tree_path = os.path.join(blocks_tree_path, ('%03x' % i) + '.blocks')
            except:
                # When the file name is not a hex id we expect a ValueError
                # and will use the tree_path of 'other.blocks'
                pass
            if verbose: print 'Moving block:', f, '->', tree_path
            if wet: os.rename(os.path.join(blocks_path, f), os.path.join(tree_path, f))
            count += 1
            if count % 1000 == 0:
                print 'Count:', count

        print 'Now removing blocks dir', blocks_path
        try:
            if wet: os.rmdir(blocks_path)
        except Exception as ex:
            print '*** Removing blocks dir failed:', ex

        print 'Finished with:', blocks_path

    print 'Done with:', agent_storage


def main():
    agent_storage_arg = None

    for arg in sys.argv[1:]:
        if arg == '--wet':
            wet = True
        elif arg in ('--verbose', '-v'):
            verbose = True
        elif os.path.isdir(arg):
            agent_storage_arg = arg
        else:
            print '*** Ignoring unknown argument:', arg

    # TODO handle windows agents?
    # TODO handle multidrive agents

    if agent_storage_arg:
        upgrade_agent_storage(agent_storage_arg)
    else:
        upgrade_agent_storage('/usr/local/noobaa/agent_storage/')

if __name__ == "__main__":
    main()
