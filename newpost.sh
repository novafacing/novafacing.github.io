#!/bin/bash

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";
read -p "Post title: " TITLE
FILETITLE=$(printf "${TITLE}" | sed 's/ /-/g')
DATE=$(date +'%Y-%m-%d')
POSTFILE="${SCRIPT_DIR}/_posts/${DATE}-${FILETITLE}.md"
touch "${POSTFILE}"
echo "---" > "${POSTFILE}"
echo "layout: post" >> "${POSTFILE}"
echo "title: ${TITLE}" >> "${POSTFILE}"
echo "categories: []" >> "${POSTFILE}"
echo "---" >> "${POSTFILE}"
echo "" >> "${POSTFILE}"
echo "${POSTFILE}"
