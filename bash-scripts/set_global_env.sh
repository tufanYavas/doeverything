#!/bin/bash

# Default values
CLI_DOE_DEV=false
CLI_DOE_FIREFOX=false

validate_is_boolean() {
  if [[ "$1" != "true" && "$1" != "false" ]]; then
    echo "Invalid value for <$2>. Please use 'true' or 'false'."
    exit 1
  fi
}

# Validate if a key starts with CLI_DOE_ or DOE_
validate_key() {
  local key="$1"
  local is_editable_section="${2:-false}"

  if [[ -n "$key" && ! "$key" =~ ^# ]]; then
    if [[ "$is_editable_section" == true && ! "$key" =~ ^DOE_ ]]; then
      echo "Invalid key: <$key>. All keys in the editable section must start with 'DOE_'."
      exit 1
    elif [[ "$is_editable_section" == false && ! "$key" =~ ^CLI_DOE_ ]]; then
      echo "Invalid key: <$key>. All CLI keys must start with 'CLI_DOE_'."
      exit 1
    fi
  fi
}

parse_arguments() {
  for arg in "$@"
  do
    key="${arg%%=*}"
    value="${arg#*=}"

    validate_key "$key"

    case $key in
      CLI_DOE_DEV)
        CLI_DOE_DEV="$value"
        validate_is_boolean "$CLI_DOE_DEV" "CLI_DOE_DEV"
        ;;
      CLI_DOE_FIREFOX)
        CLI_DOE_FIREFOX="$value"
        validate_is_boolean "$CLI_DOE_FIREFOX" "CLI_DOE_FIREFOX"
        ;;
      *)
        cli_values+=("$key=$value")
        ;;
    esac
  done
}

# Validate keys in .env file
validate_env_keys() {
  editable_section_starts=false

  while IFS= read -r line; do
    key="${line%%=*}"
    if [[ "$key" =~ ^CLI_DOE_ ]]; then
      editable_section_starts=true
    elif $editable_section_starts; then
      validate_key "$key" true
    fi
  done < .env
}

create_new_file() {
  temp_file=$(mktemp)

  {
    echo "# THOSE VALUES ARE EDITABLE ONLY VIA CLI"
    echo "CLI_DOE_DEV=$CLI_DOE_DEV"
    echo "CLI_DOE_FIREFOX=$CLI_DOE_FIREFOX"
    for value in "${cli_values[@]}"; do
      echo "$value"
    done
    echo ""
    echo "# THOSE VALUES ARE EDITABLE"

    # Copy existing env values, without CLI section
    grep -E '^DOE_' .env
  } > "$temp_file"

  mv "$temp_file" .env
}

# Main script execution
parse_arguments "$@"
validate_env_keys
create_new_file
