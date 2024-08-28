# Custom configs for Spin environments
# This file will only be executed on Spin environments.
ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

case $ZSH_HOST_OS in
darwin*)

  ;;
linux*)
  HOST_OS_ID=$(awk -F= '$1=="ID" { print $2 ;}' /etc/os-release | tr -d '"')
  case $HOST_OS_ID in
    ubuntu)

      if command -v batcat > /dev/null 2>&1; then
        alias bat=batcat
      fi
      if command -v fdfind > /dev/null 2>&1; then
        alias fd=fdfind
      fi
      export PATH="$HOME/.fzf/bin:$PATH"

    ;;
  esac
  ;;
esac
