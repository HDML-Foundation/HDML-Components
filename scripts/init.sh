#!/bin/bash

# @author Artem Lytvynov
# @copyright Artem Lytvynov
# @license Apache-2.0

git config --global --add safe.directory '*'
git config core.sshCommand "$(which ssh) -i /home/.ssh/hdml.github"
git config --global user.email "hdml.github@gmail.com"
git config --global user.name "hdml-github"
