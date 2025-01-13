git push -f ssh://$GDS4N1:/root/guym/noobaa-core guy-rdma &&
  ssh $GDS4N1 'cd /root/guym/noobaa-core && git rebase guy-rdma' && 
  printf "\n\n IT'S DONE. \n\n"
