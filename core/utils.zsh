# Useful aliases and functions

# From https://twitter.com/climagic/status/370595711483514880
# Example: git push origin master -f || fliptable
fliptable()
{
	echo "（╯°□°）╯ ┻━┻";
}

ultraflip()
{
	echo " ┻━┻ ︵╰(°□°)╯︵ ┻━┻";
}

# Open VSCode on the current directory
vs () {
	code .
}

# Switch to the `main` branch of your current repo
cmain () {
  git checkout main
}

# Checkout the `master` branch of your current repo
cmaster () {
	git checkout master
}

# Switch to the last branch you were on before the current one
clast () {
	git checkout @{-1}
}

# Switch to the Nth previous branch before the current one
# If you checked out `main`, then `dev`, then `myfeature`,
# running `clastn 2` would switch to `main`
clastn () {
	git checkout @{-$1}
}

# Grep for X in a directory
grll ()
{
	ls --color -lah --group-directories-first | grep $1
}

##
# Create a local SSH tunnel to a remote service.
# This is just a stub to remember the command.
tun()
{
	local username="$1"
	local service_local="$2"
	local service_remote="$3"
	ssh -f -T -N -L $service_local:$service_remote -pPORT $username@$remote_server
}

##
# Get current OS version and other information.
v()
{
	case $OS in
		osx)
			system_profiler SPSoftwareDataType
			;;
		# Note, at this point nix is technically CentOS. Update .bashrc to
		# represent more OSes.
		nix)
			echo -e "Operating System:\n"
			echo -e "    `cat /etc/redhat-release`\n"
			;;
	esac

	echo -e "Kernel & Architecture:\n"
	echo -e "    `uname -r -v -p`\n"
}

##
# Pass a filename, with archive extension, and this will figure out the rest.
#
# Usage: archive <desiredfilename>.<extension> [ directory | filename ]
#
# For example, type "archive updates.tar.gz updatesdir" and this function will run the
# necessary commands for generating an archive with .tar.gz compression.
#
# Note: bz2 exclusively requires that you just pass bz2 as the desiredfilename
# because it cannot be output into a single file, but each file will be
# individually archived with bzip2 compression.
#
archive()
{
	case $1 in
		*bz2)       bzip2 "${@:2}" ;;
		*.gz)       gzip -c "${@:2}" > $1 ;;
		*.tar)      tar -cvf $1 "${@:2}" ;;
		*.tbz)      tar -jcvf $1 "${@:2}" ;;
		*.tbz2)     tar -jcvf $1 "${@:2}" ;;
		*.tar.bz2)  tar -jcvf $1 "${@:2}" ;;
		*.tgz)      tar -zcvf $1 "${@:2}" ;;
		*.tar.gz)   tar -zcvf $1 "${@:2}" ;;
		*.zip)      zip -r $1 "${@:2}" ;;
		*.ZIP)      zip -r $1 "${@:2}" ;;
		*)          echo "'${@:2}' cannot be archived via archive()" ;;
	esac
}

##
# Usage: extract <file>
# Description: extracts archived files / mounts disk images
# Note: .dmg/hdiutil is Mac OS X-specific.
# Credit: https://github.com/holman/dotfiles
extract ()
{
	if [ -f $1 ]; then
		case $1 in
			*.tar.bz2)  tar -jxvf $1 ;;
			*.tar.gz)   tar -zxvf $1 ;;
			*.bz2)      bunzip2 $1 ;;
			*.dmg)      hdiutil mount $1 ;;
			*.gz)       gunzip $1 ;;
			*.tar)      tar -xvf $1 ;;
			*.tbz2)     tar -jxvf $1 ;;
			*.tgz)      tar -zxvf $1 ;;
			*.zip)      unzip $1 ;;
			*.ZIP)      unzip $1 ;;
			*.pax)      cat $1 | pax -r ;;
			*.pax.Z)    uncompress $1 --stdout | pax -r ;;
			*.Z)        uncompress $1 ;;
			*)          echo "'$1' cannot be extracted/mounted via extract()" ;;
		esac
	else
		echo "'$1' is not a valid file"
	fi
}


##
# Determine size of a file or total size of a directory.
# Credit: https://github.com/mathiasbynens/dotfiles
fs()
{
	if du -b /dev/null > /dev/null 2>&1; then
		local arg=-sbh;
	else
		local arg=-sh;
	fi

	if [[ -n "$@" ]]; then
		du $arg -- "$@";
	else
		du $arg .[^.]* *;
	fi
}

##
# Get total directory and file count.
# TODO: integrate filesizes
tt()
{
	CHECKDIR=.
	if [[ -n "$1" ]]; then
		CHECKDIR="$1"
	fi

	# Directory listings include "." and ".."
	DIRECTORY_PADDING=1

	DIRECTORIES="`find $CHECKDIR -maxdepth 1 -type d | wc -l`"
	DIRECTORIES_WITH_LINKS="`find $CHECKDIR -follow -maxdepth 1 -type d | wc -l`"
	DIRECTORIES_LINKS="`expr $DIRECTORIES_WITH_LINKS - $DIRECTORIES`"
	FILES="`find $CHECKDIR -maxdepth 1 -type f | wc -l`"
	FILES_WITH_LINKS="`find $CHECKDIR -follow -maxdepth 1 -type f | wc -l`"
	FILES_LINKS="`expr $FILES_WITH_LINKS - $FILES`"

	echo "Directories: `expr $DIRECTORIES_WITH_LINKS - $DIRECTORY_PADDING` (`expr $DIRECTORIES_LINKS`)"
	echo "Files: $FILES_WITH_LINKS ($FILES_LINKS)"
}

# Find file
# Usage: ff (file)
ff()
{
  find . -name $1
}

get_hex ()
{
  echo $1 | hexdump
}
