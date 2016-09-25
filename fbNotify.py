#!/usr/bin/env python

from subprocess import check_output
import re
import urllib2
import sys

oldest = sys.argv[1]
last_hash = sys.argv[2]
refname = sys.argv[3]

RE_COMMIT_HASH = r"^commit.([0-9a-fA-F]+)$"
RE_BUG_NUMBERS = r"(?:cases?|Bug[sz] ?IDs?)[: ] *\d+(?:[,: ] *\d+)*"
# The above regex makes mistakes for messages like "bugzid 1: 42 lines added"
# Use the below line instead to require a colon after the bug numbers
# RE_BUG_NUMBERS = r"(?:cases?|Bug[sz] ?IDs?)[: ] *\d+(?:[,: ] *\d+):*"
BUGZ_URL = "https://noobaa.fogbugz.com/"
IXREPOSITORY="1"
FOGBUGZ_URL_FORMAT = BUGZ_URL + "/cvsSubmit.asp?ixBug={}&sFile={}&sPrev={}&sNew={}&ixRepository=" + IXREPOSITORY


def get_commit_hashes(oldest, last_hash):
    # get all of the commit hashes
    if oldest == '0000000000000000000000000000000000000000':
        # Pushed a new branch, so get a list of all heads, and figure out what changesets are only in the new branch
        heads_output = check_output(['git', 'for-each-ref', '--format="%(refname)"', 'refs/heads'])
        other_heads = heads_output.replace('"','').strip('\n').split('\n')
        other_heads.remove(refname)
        output = check_output(['git', 'log', '--no-merges', last_hash, '--not'] + other_heads)
    else:
        # Pushed to an existing branch, so get a list of the pushed changesets
        output = check_output(['git', 'log', "{}..{}".format(oldest, last_hash)])
    hashes = re.findall(RE_COMMIT_HASH, output, flags=re.MULTILINE)
    hashes.append(oldest)
    hashes.reverse()  # make the newest commit last
    return hashes


def get_bug_numbers(commit_hash):
    # get the bug numbers
    output = check_output(['git', 'cat-file', 'commit', commit_hash])
    match = re.search(RE_BUG_NUMBERS, output, flags=re.MULTILINE | re.IGNORECASE)
    
    if match:
        return re.findall('\d+', match.group(0))
    return None


def get_files_committed(commit_hash):
    # get the list of the files checked in
    output = check_output(['git', 'log', '-1', '--name-only', '--pretty=format:""', last_hash])
    files = output.strip('\n"').split('\n')
    return files


commits = get_commit_hashes(oldest, last_hash)
for i, rev in enumerate(commits[1:]):  # don't do the parent, it was done previously
    bug_numbers = get_bug_numbers(rev)

    if bug_numbers:  # don't bother if no bugs were committed against
        files = get_files_committed(rev)

        for bug_number in bug_numbers:
            for file in files:
                urllib2.urlopen(FOGBUGZ_URL_FORMAT.format(bug_number, file, commits[i-1], rev))
